const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(__dirname));

let players = {};
let gameState = {
    submissions: {},
    scores: {}, // 점수판
    jackpot: 1,
    isPlaying: false,
    config: { carryover: true },
    firstPlayer: null 
};

io.on('connection', (socket) => {
    console.log('접속:', socket.id);

    if (Object.keys(players).length >= 2) {
        socket.emit('full_room', '방이 꽉 찼습니다.');
        socket.disconnect();
        return;
    }

    players[socket.id] = { id: socket.id };
    
    // 내 점수 칸 만들기 (없으면 0점)
    if (gameState.scores[socket.id] === undefined) {
        gameState.scores[socket.id] = 0;
    }

    const isHost = (Object.keys(players).length === 1);
    socket.emit('player_role', { isHost: isHost });

    io.emit('update_player_count', Object.keys(players).length);

    // [게임 시작]
    socket.on('request_start_game', (options) => {
        if (Object.keys(players).length < 2) return;

        gameState.config.carryover = options.carryover;
        gameState.isPlaying = true;
        gameState.jackpot = 1;
        gameState.submissions = {};
        
        // 현재 접속자들 점수 0으로 초기화
        Object.keys(players).forEach(id => gameState.scores[id] = 0);
        
        // 첫 판은 선공 없음 (선착순)
        gameState.firstPlayer = null;

        io.emit('game_start', {
            msg: `게임 시작!`,
            scores: gameState.scores,
            firstPlayer: gameState.firstPlayer
        });
    });

    // [카드 제출]
    socket.on('submit_card', (cardNumber) => {
        if (!gameState.isPlaying) return;
        if (gameState.submissions[socket.id]) return;

        // 선공 체크
        const submitCount = Object.keys(gameState.submissions).length;
        if (submitCount === 0 && gameState.firstPlayer !== null && socket.id !== gameState.firstPlayer) {
            socket.emit('warning', '당신 차례가 아닙니다! 승자가 먼저 내야 합니다.');
            return;
        }

        gameState.submissions[socket.id] = cardNumber;
        const isEven = (cardNumber % 2 === 0);
        const colorName = isEven ? "흑색" : "백색";

        socket.emit('message', `나의 선택: ${cardNumber}`);
        socket.broadcast.emit('opponent_submitted', {
            msg: `상대방 제출 완료`,
            color: colorName
        });

        if (Object.keys(gameState.submissions).length === 2) {
            evaluateRound();
        }
    });

    // [연결 종료]
    socket.on('disconnect', () => {
        delete players[socket.id];
        
        // ★ [핵심 수정] 나간 사람의 점수판도 삭제 (이거 안 하면 점수 꼬임)
        delete gameState.scores[socket.id];

        gameState.isPlaying = false;
        gameState.submissions = {};
        io.emit('update_player_count', Object.keys(players).length);
        io.emit('player_left', '상대방이 나갔습니다. 게임이 종료됩니다.');
    });
});

function evaluateRound() {
    const ids = Object.keys(gameState.submissions);
    const p1 = ids[0];
    const p2 = ids[1];
    const c1 = gameState.submissions[p1];
    const c2 = gameState.submissions[p2];

    let winnerId = null;

    if (c1 === c2) { // 무승부
        gameState.jackpot = gameState.config.carryover ? gameState.jackpot + 1 : 1;
    } else {
        let p1Wins = false;
        if (c1 === 1 && c2 === 9) p1Wins = true;
        else if (c1 === 9 && c2 === 1) p1Wins = false;
        else if (c1 > c2) p1Wins = true;
        
        winnerId = p1Wins ? p1 : p2;
        gameState.firstPlayer = winnerId;
    }

    if (winnerId) {
        gameState.scores[winnerId] += gameState.jackpot;
        gameState.jackpot = 1;
    }

    // 결과 전송 (최신 점수 포함)
    io.emit('round_result', {
        winnerId: winnerId,
        firstPlayer: gameState.firstPlayer,
        cards: gameState.submissions,
        scores: gameState.scores 
    });

    // 점수판 업데이트
    io.emit('update_score', gameState.scores);
    gameState.submissions = {};
}

server.listen(3000, () => {
    console.log('서버 실행 중: http://localhost:3000');
});