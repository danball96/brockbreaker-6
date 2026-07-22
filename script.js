const canvas = document.getElementById("gameCanvas");
const ctx = canvas.getContext("2d");

// 前景画像 (ブロックの代わりに表示)
const fgImg = new Image();
fgImg.src = "test1.png";

let isGameStarted = false;
let isGameOver = false;
let isGameClear = false;

// パドル
const paddleWidth = 100;
const paddleHeight = 10;
let paddleX = (canvas.width - paddleWidth) / 2;
const paddleY = canvas.height - paddleHeight - 20;

// ボール
let ballRadius = 8;
let ballX = canvas.width / 2;
let ballY = paddleY - ballRadius;
let ballDX = 5;
let ballDY = -5;

// ブロック設定
const blockRowCount = 8;
const blockColumnCount = 10;
const blockWidth = canvas.width / blockColumnCount; // 80px
const blockHeight = 60; // 60px -> 8行で高さ480px分ブロックが配置される

const blocks = [];
for (let c = 0; c < blockColumnCount; c++) {
    blocks[c] = [];
    for (let r = 0; r < blockRowCount; r++) {
        blocks[c][r] = { x: c * blockWidth, y: r * blockHeight, status: 1 };
    }
}

// キー操作
let rightPressed = false;
let leftPressed = false;

document.addEventListener("keydown", keyDownHandler);
document.addEventListener("keyup", keyUpHandler);
document.addEventListener("mousemove", mouseMoveHandler);
document.addEventListener("click", clickHandler);

// スマートフォン用タッチ対応
document.addEventListener("touchmove", touchMoveHandler, {passive: false});
document.addEventListener("touchstart", touchStartHandler, {passive: false});

function keyDownHandler(e) {
    if (e.key === "Right" || e.key === "ArrowRight") rightPressed = true;
    else if (e.key === "Left" || e.key === "ArrowLeft") leftPressed = true;
}

function keyUpHandler(e) {
    if (e.key === "Right" || e.key === "ArrowRight") rightPressed = false;
    else if (e.key === "Left" || e.key === "ArrowLeft") leftPressed = false;
}

function mouseMoveHandler(e) {
    const relativeX = e.clientX - canvas.getBoundingClientRect().left;
    if (relativeX > 0 && relativeX < canvas.width) {
        paddleX = relativeX - paddleWidth / 2;
    }
}

function clickHandler() {
    if (!isGameStarted && !isGameOver && !isGameClear) {
        isGameStarted = true;
    } else if (isGameOver || isGameClear) {
        document.location.reload(); // 再スタート
    }
}

function touchMoveHandler(e) {
    e.preventDefault();
    const relativeX = e.touches[0].clientX - canvas.getBoundingClientRect().left;
    if (relativeX > 0 && relativeX < canvas.width) {
        paddleX = relativeX - paddleWidth / 2;
    }
}

function touchStartHandler(e) {
    clickHandler();
}

// 衝突判定
function collisionDetection() {
    for (let c = 0; c < blockColumnCount; c++) {
        for (let r = 0; r < blockRowCount; r++) {
            let b = blocks[c][r];
            if (b.status === 1) {
                if (ballX + ballRadius > b.x && ballX - ballRadius < b.x + blockWidth && 
                    ballY + ballRadius > b.y && ballY - ballRadius < b.y + blockHeight) {
                    
                    ballDY = -ballDY;
                    b.status = 0;
                    
                    checkWin();
                }
            }
        }
    }
}

function checkWin() {
    let won = true;
    for (let c = 0; c < blockColumnCount; c++) {
        for (let r = 0; r < blockRowCount; r++) {
            if (blocks[c][r].status === 1) {
                won = false;
                break;
            }
        }
    }
    if (won) {
        isGameClear = true;
    }
}

// 描画関係
function drawBall() {
    ctx.beginPath();
    ctx.arc(ballX, ballY, ballRadius, 0, Math.PI * 2);
    ctx.fillStyle = "#ffeb3b";
    ctx.fill();
    // ちょっとした立体感
    ctx.lineWidth = 1;
    ctx.strokeStyle = "#000";
    ctx.stroke();
    ctx.closePath();
}

function drawPaddle() {
    ctx.beginPath();
    // 角丸のパドルを描画
    ctx.roundRect ? ctx.roundRect(paddleX, paddleY, paddleWidth, paddleHeight, 5) : ctx.rect(paddleX, paddleY, paddleWidth, paddleHeight);
    ctx.fillStyle = "#ffffff";
    ctx.fill();
    ctx.closePath();
}

function drawBlocks() {
    if(!fgImg.complete) return; // 画像未ロードなら描画をスキップ

    for (let c = 0; c < blockColumnCount; c++) {
        for (let r = 0; r < blockRowCount; r++) {
            if (blocks[c][r].status === 1) {
                let bX = blocks[c][r].x;
                let bY = blocks[c][r].y;
                
                // test1.png の対象領域を切り出して描画
                ctx.drawImage(fgImg, bX, bY, blockWidth, blockHeight, bX, bY, blockWidth, blockHeight);
                
                // ブロックの枠線をうっすら描画してブロック感・パズル感を出す
                ctx.strokeStyle = "rgba(0, 0, 0, 0.2)";
                ctx.lineWidth = 1;
                ctx.strokeRect(bX, bY, blockWidth, blockHeight);
            }
        }
    }
}

function draw() {
    // 描画ごと画面をクリア。透明なCanvasの下にあるCSS背景(test3.png)が透けて見える
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    drawBlocks();
    drawPaddle();
    drawBall();
    collisionDetection();

    // ゲームオーバー/クリア判定
    if (isGameOver) {
        ctx.font = "48px bold 'Segoe UI'";
        ctx.fillStyle = "rgba(255, 0, 0, 0.9)";
        ctx.textAlign = "center";
        ctx.fillText("GAME OVER", canvas.width/2, canvas.height/2);
        
        ctx.font = "20px 'Segoe UI'";
        ctx.fillStyle = "#fff";
        ctx.fillText("Click to Retry", canvas.width/2, canvas.height/2 + 40);
        return; // ループ停止
    }
    if (isGameClear) {
        ctx.font = "48px bold 'Segoe UI'";
        ctx.fillStyle = "rgba(0, 255, 0, 0.9)";
        ctx.textAlign = "center";
        ctx.fillText("CLEAR!", canvas.width/2, canvas.height/2);
        
        ctx.font = "20px 'Segoe UI'";
        ctx.fillStyle = "#fff";
        ctx.fillText("Click to Retry", canvas.width/2, canvas.height/2 + 40);
        return; // ループ停止
    }

    if (isGameStarted) {
        // パドルの境界判定
        if (rightPressed && paddleX < canvas.width - paddleWidth) {
            paddleX += 7;
        } else if (leftPressed && paddleX > 0) {
            paddleX -= 7;
        }

        // 次のボール位置
        let nextBallX = ballX + ballDX;
        let nextBallY = ballY + ballDY;

        // 壁の反射判定 (左右)
        if (nextBallX > canvas.width - ballRadius || nextBallX < ballRadius) {
            ballDX = -ballDX;
        }
        // 壁の反射判定 (上)
        if (nextBallY < ballRadius) {
            ballDY = -ballDY;
        } 
        // 下に落ちた場合
        else if (nextBallY > canvas.height - ballRadius) {
            isGameOver = true;
        }

        // パドルの反射判定
        if(nextBallY + ballRadius >= paddleY && nextBallY - ballRadius <= paddleY + paddleHeight) {
            if(nextBallX >= paddleX && nextBallX <= paddleX + paddleWidth) {
                // ボールがパドルに当たった
                let collidePoint = nextBallX - (paddleX + paddleWidth / 2);
                collidePoint = collidePoint / (paddleWidth / 2); // -1 から 1
                
                let angle = collidePoint * (Math.PI / 3); // 最大60度
                let speed = Math.sqrt(ballDX*ballDX + ballDY*ballDY);
                
                ballDX = speed * Math.sin(angle);
                ballDY = -speed * Math.cos(angle);
                
                // パドルに埋まらないように位置を補正
                ballY = paddleY - ballRadius;
            }
        }

        ballX += ballDX;
        ballY += ballDY;
    } else {
        // スタート前はボールをパドルの上に追従させる
        ballX = paddleX + paddleWidth / 2;
        ballY = paddleY - ballRadius;
    }

    requestAnimationFrame(draw);
}

// 画像の読み込み完了後にゲームループを開始
fgImg.onload = () => {
    // Canvasフォントを事前に読み込ませるためのダミーなど（今回は割愛）
    draw(); // 最初のフレームを描画して待機
};

// 念のため、エラーハンドリング
fgImg.onerror = () => {
    console.error("test1.png の読み込みに失敗しました。");
    // 画像がなくても一応ゲームが動くようにする
    draw();
};
