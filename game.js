// import { Capacitor } from '@capacitor/core';
// import { AdMob, BannerAdSize, BannerAdPosition } from '@capacitor-community/admob';

document.addEventListener('DOMContentLoaded', () => {
    async function initializeAdMob() {
        const isNative = typeof Capacitor !== 'undefined' && Capacitor.isNativePlatform();
        if (isNative) {
            try {
                await AdMob.initialize({
                    requestTrackingAuthorization: true,
                    initializeForTesting: true, // テストモード
                });

                await AdMob.showBanner({
                    adId: 'ca-app-pub-3940256099942544/6300978111', // AdMobのテスト用バナーID
                    adSize: BannerAdSize.BANNER,
                    position: BannerAdPosition.TOP_CENTER,
                    margin: 0,
                    isTesting: true
                });
                console.log("AdMob Banner is loaded.");
            } catch (e) {
                console.error("AdMob Initialization Failed:", e);
            }
        } else {
            console.log("Web環境のためAdMobネイティブ広告はスキップします。（表示エリアはCSSで確保されています）");
        }
    }
    initializeAdMob();

    // スクリーン管理
    const screens = {
        title: document.getElementById('title-screen'),
        stageSelect: document.getElementById('stage-select-screen'),
        game: document.getElementById('game-screen'),
        result: document.getElementById('result-screen'),
        bonus: document.getElementById('clear-bonus-screen'),
        settings: document.getElementById('settings-screen')
    };

    function showScreen(screenName) {
        Object.values(screens).forEach(s => s.classList.remove('active'));
        screens[screenName].classList.add('active');
        if (screenName === 'stageSelect') renderStageSelect();
    }

    const bgCanvas = document.getElementById('bg-canvas');
    const gameCanvas = document.getElementById('game-canvas');
    const bgCtx = bgCanvas.getContext('2d');
    const gameCtx = gameCanvas.getContext('2d');

    let currentStage = 1;
    const bgImg = new Image();
    const fgImg = new Image();

    // ゲーム状態変数
    let animationId;
    let isGameStarted = false;
    let isGameOver = false;
    let isGameClear = false;
    let lives = 2;

    // ゲームパラメータ（localStorageから読み込み、なければデフォルト値）
    let BLOCK_RESTORE_RATE = parseFloat(localStorage.getItem('breakout_restore_rate') || '0.12');
    let LASER_CHARGE_TIME = parseFloat(localStorage.getItem('breakout_laser_time') || '100.0');
    let POINTS_BONUS_RATE = parseFloat(localStorage.getItem('breakout_points_bonus') || '20.0');
    let AD_FREQUENCY = parseFloat(localStorage.getItem('breakout_ad_freq') || '70.0');
    let ITEM_DROP_RATE = parseFloat(localStorage.getItem('breakout_item_drop') || '4.0');

    // 音量管理 (localStorageから読み込み、デフォルトは 1.0 = 100%)
    let BGM_VOLUME = parseFloat(localStorage.getItem('breakout_bgm_vol') ?? '1.0');
    let SE_VOLUME = parseFloat(localStorage.getItem('breakout_se_vol') ?? '1.0');

    // BGMオブジェクト
    const bgmAudio = new Audio();
    bgmAudio.src = "assets/Burning_glow.wav";
    bgmAudio.loop = true;
    bgmAudio.volume = BGM_VOLUME;

    // 色覚サポート (localStorageから読み込み、デフォルトは false)
    let COLOR_BLIND_MODE = localStorage.getItem('breakout_color_blind') === 'true';

    // SE再生関数
    function playSE(srcPath) {
        if (SE_VOLUME === 0) return;
        try {
            const se = new Audio(srcPath);
            se.volume = SE_VOLUME;
            se.play().catch(e => console.warn("SE play failed", e));
        } catch (e) {
            console.error("SE load failed", e);
        }
    }

    // スコア管理ロジック
    let score = 0;
    let missCount = 0;
    let totalMissCountOffset = 0; // コンティニュー前のミス回数累計
    let totalPoints = 0;
    try {
        totalPoints = parseInt(localStorage.getItem('breakout_points') || '0', 10);
    } catch (e) {
        console.warn("localStorage is restricted.", e);
    }

    function updatePointsUI() {
        const pointsSpan = document.getElementById('total-points');
        if (pointsSpan) pointsSpan.textContent = totalPoints.toString();
    }
    updatePointsUI();

    // 復活・一時停止関係
    let isRespawning = false;
    let isShowingEndMessage = false;
    let isPaused = false;
    let hasBarrier = false;
    let items = []; // 落下アイテム [ {x, y, type} ]
    let penetratingBalls = []; // 貫通弾 [ {x, y, dx, dy} ]

    // レーザー関係
    let laserChargeAccumulated = 0; // 蓄積されたゲーム内時間（ms）
    let laserLastFrameTime = null;  // フレーム間の時間計測用
    let isLaserFiring = false;      // レーザー発射中フラグ
    let laserFireX = 0;             // レーザーのX座標
    let laserFireTime = 0;          // レーザー発射開始時刻
    const LASER_DURATION = 600;     // レーザー表示持続時間（ms）
    let respawnStartTime = 0;

    // --- 新規追加: アンロック、EXTRAモード ---
    let unlockedStages = [];
    try {
        const saved = localStorage.getItem('breakout_unlocked_stages');
        unlockedStages = saved ? JSON.parse(saved) : [1];
    } catch (e) {
        unlockedStages = [1];
    }
    let gameMode = 'normal'; // 'normal', 'extra', 'gallery'

    function saveUnlocks() {
        localStorage.setItem('breakout_unlocked_stages', JSON.stringify(unlockedStages));
    }

    // --- クリア済ステージの状態管理 ---
    let clearedNormalStages = [];
    let clearedExtraStages = [];
    try {
        clearedNormalStages = JSON.parse(localStorage.getItem('breakout_cleared_normal') || '[]');
        clearedExtraStages = JSON.parse(localStorage.getItem('breakout_cleared_extra') || '[]');
    } catch (e) {
        clearedNormalStages = [];
        clearedExtraStages = [];
    }

    function saveClears() {
        localStorage.setItem('breakout_cleared_normal', JSON.stringify(clearedNormalStages));
        localStorage.setItem('breakout_cleared_extra', JSON.stringify(clearedExtraStages));
    }

    // --- ギャラリーモード用変数 ---
    let isGalleryActive = false;
    let galleryTargetStage = 1;
    let galleryViewType = 'fg'; // 'fg' (ブロック画像) or 'bg' (背景画像)

    // デバッグ系の変数
    let isDebugMode = false;
    let debugKeySequence = "debug";
    let debugKeyIndex = 0;
    let lastDebugKeyTime = 0;

    // スピード保存用
    let speedBase = 3;
    let balls = []; // { x, y, dx, dy, radius } の配列

    // 互換性・簡略化のため、古い変数は削除せず、配列の0番目を参照するゲッター的に扱う箇所もありますが、
    // 基本はループ処理に移行します。

    // アイテムの種類
    const ITEM_TYPES = {
        ENERGY_BOX: 'energy_box',
        PENETRATE: 'penetrate',
        BARRIER: 'barrier'
    };

    // パドル情報
    let paddleWidth, paddleHeight, paddleX, paddleY;

    // ボール情報
    let ballRadius; // ballX, ballY等はspeedBase付近で初期値付きで宣言済み

    // ブロック情報
    let blockRowCount = 8;
    const blockColumnCount = 8;
    let blockWidth, blockHeight;
    let blocks = [];

    // 操作入力フラグ
    let rightPressed = false;
    let leftPressed = false;

    // 定数の初期化（画面サイズに応じたレスポンシブ対応）
    function initBallsAfterMiss() {
        const spawnBall = (offsetDX = 0) => {
            const initialSpeed = speedBase * 0.60;
            const launchAngle = (Math.PI / 12 + Math.random() * (Math.PI / 9))
                * (Math.random() > 0.5 ? 1 : -1);
            return {
                x: paddleX + paddleWidth / 2,
                y: paddleY - ballRadius,
                dx: initialSpeed * Math.sin(launchAngle) + offsetDX,
                dy: -initialSpeed * Math.cos(launchAngle),
                radius: ballRadius
            };
        };

        balls = [];
        balls.push(spawnBall());
    }

    function initGameConstants() {
        const cw = gameCanvas.width;
        const ch = gameCanvas.height;

        paddleWidth = cw * 0.25;
        paddleHeight = Math.max(10, ch * 0.02);
        paddleX = (cw - paddleWidth) / 2;
        paddleY = ch - paddleHeight - 55;

        ballRadius = Math.max(5, cw * 0.015);
        speedBase = ch * 0.012;

        initBallsAfterMiss();

        blockWidth = cw / blockColumnCount;
        const imageHeight = cw * (3 / 2);
        blockRowCount = 30;
        blockHeight = imageHeight / blockRowCount;

        blocks = [];
        for (let c = 0; c < blockColumnCount; c++) {
            blocks[c] = [];
            for (let r = 0; r < blockRowCount; r++) {
                blocks[c][r] = { x: c * blockWidth, y: r * blockHeight, status: 1 };
            }
        }
    }

    function resizeCanvas() {
        if (!screens.game.classList.contains('active')) return;
        const container = document.getElementById('game-container');
        const containerW = container.clientWidth;
        const containerH = container.clientHeight;

        // 9:20 アスペクト比を強制する
        const targetRatio = 9 / 20;
        let canvasW, canvasH;

        if (containerW / containerH > targetRatio) {
            // コンテナが横に広すぎる場合、高さを基準にする
            canvasH = containerH;
            canvasW = canvasH * targetRatio;
        } else {
            // コンテナが縦に長すぎる場合、幅を基準にする
            canvasW = containerW;
            canvasH = canvasW / targetRatio;
        }

        // キャンバスの内部解像度を設定
        bgCanvas.width = canvasW;
        bgCanvas.height = canvasH;
        gameCanvas.width = canvasW;
        gameCanvas.height = canvasH;

        // CSSによる中央配置
        const offsetX = (containerW - canvasW) / 2;
        const offsetY = (containerH - canvasH) / 2;

        bgCanvas.style.width = `${canvasW}px`;
        bgCanvas.style.height = `${canvasH}px`;
        bgCanvas.style.left = `${offsetX}px`;
        bgCanvas.style.top = `${offsetY}px`;

        gameCanvas.style.width = `${canvasW}px`;
        gameCanvas.style.height = `${canvasH}px`;
        gameCanvas.style.left = `${offsetX}px`;
        gameCanvas.style.top = `${offsetY}px`;
    }

    window.addEventListener('resize', () => {
        if (!isGameStarted) resizeCanvas();
    });

    // バックグラウンド移行時のポーズ処理
    let bgmWasPlayingBeforePause = false;
    document.addEventListener('visibilitychange', () => {
        if (document.hidden) {
            bgmWasPlayingBeforePause = !bgmAudio.paused;
            if (isGameStarted && !isGameOver && !isGameClear && !isPaused) {
                isPaused = true;
                document.getElementById('quit-confirm-overlay').classList.add('active');
            }
            bgmAudio.pause();
        } else {
            if (bgmWasPlayingBeforePause) {
                bgmAudio.play().catch(e => {
                    // 自動再生がブロックされた場合は、次のタッチ・クリック操作で再開する
                    const resumeAudio = () => {
                        bgmAudio.play();
                        document.removeEventListener('click', resumeAudio);
                        document.removeEventListener('touchstart', resumeAudio);
                    };
                    document.addEventListener('click', resumeAudio, {once: true});
                    document.addEventListener('touchstart', resumeAudio, {once: true});
                });
            }
        }
    });

    // --- ステージ選択画面の初期化・更新 ---
    function getStageUnlockCost(stageNum) {
        switch (stageNum) {
            case 1: return 0;
            case 2: return 5000;
            case 3: return 10000;
            case 4: return 15000;
            case 5: return 20000;
            case 6: return 30000;
            case 7: return 40000;
            case 8: return 50000;
            case 9: return 49500;
            default: return 0;
        }
    }

    function renderStageSelect() {
        const stageItems = document.querySelectorAll('.stage-item');
        let allUnlocked = true;

        stageItems.forEach(item => {
            const stageNum = parseInt(item.getAttribute('data-stage'), 10);
            const btn = item.querySelector('.stage-btn');
            const overlay = item.querySelector('.lock-overlay');
            const cost = getStageUnlockCost(stageNum);

            if (unlockedStages.includes(stageNum)) {
                item.classList.remove('locked');
                btn.disabled = false;
                if (overlay) overlay.style.display = 'none';

                // ステージ選択時の挙動
                btn.onclick = () => {
                    if (gameMode === 'gallery') {
                        galleryTargetStage = stageNum;
                        enterGallery(stageNum);
                    } else {
                        currentStage = stageNum;
                        startGame(stageNum);
                    }
                };
            } else {
                allUnlocked = false;
                item.classList.add('locked');
                btn.disabled = true;
                if (overlay) {
                    overlay.style.display = 'flex';
                    overlay.onclick = () => {
                        if (totalPoints >= cost) {
                            if (confirm(`このステージを ${cost.toLocaleString()} ポイントで開放しますか？`)) {
                                totalPoints -= cost;
                                unlockedStages.push(stageNum);
                                saveUnlocks();
                                localStorage.setItem('breakout_points', totalPoints.toString());
                                updatePointsUI();
                                renderStageSelect();
                            }
                        } else {
                            alert(`開放にはあと ${(cost - totalPoints).toLocaleString()} ポイント必要です。`);
                        }
                    };
                }
            }
        });

        // モード選択の表示（全開放に関わらず、ギャラリーと情報は常にアクセス可能にする）
        const modeSelector = document.getElementById('mode-selector');
        const modeExtra = document.getElementById('mode-extra');

        modeSelector.style.display = 'flex';

        if (allUnlocked) {
            modeExtra.style.display = 'block';
        } else {
            modeExtra.style.display = 'none';
            if (gameMode === 'extra') {
                gameMode = 'normal';
                document.body.classList.remove('extra-active');
            }
        }
        updateModeButtons();
    }

    function updateModeButtons() {
        document.getElementById('mode-normal').classList.toggle('active', gameMode === 'normal');
        document.getElementById('mode-extra').classList.toggle('active', gameMode === 'extra');
        document.getElementById('mode-gallery').classList.toggle('active', gameMode === 'gallery');
    }

    // キーボード操作
    document.addEventListener("keydown", (e) => {
        if (e.key === "Right" || e.key === "ArrowRight") rightPressed = true;
        else if (e.key === "Left" || e.key === "ArrowLeft") leftPressed = true;

        // デバッグモードのコマンド入力受付
        // 1回ミスして2個目のボールを使い始める前（再開前）のみ受け付ける
        if (lives === 1 && !isGameStarted && !isGameOver && !isGameClear && !isRespawning) {
            const key = e.key.toLowerCase();
            const expectedKey = debugKeySequence[debugKeyIndex];

            if (key === expectedKey) {
                const now = Date.now();
                // 1秒(1000ms)以上の時間差
                if (debugKeyIndex === 0 || now - lastDebugKeyTime >= 1000) {
                    debugKeyIndex++;
                    lastDebugKeyTime = now;
                    if (debugKeyIndex === debugKeySequence.length) {
                        isDebugMode = true;
                        debugKeyIndex = 0;
                        console.log("Debug Mode Activated");
                    }
                } else {
                    debugKeyIndex = 0; // 入力が早すぎた場合はリセット
                }
            } else {
                debugKeyIndex = 0; // 違うキーの場合はリセット
            }
        }
    });

    document.addEventListener("keyup", (e) => {
        if (e.key === "Right" || e.key === "ArrowRight") rightPressed = false;
        else if (e.key === "Left" || e.key === "ArrowLeft") leftPressed = false;
    });

    function getRelativeX(clientX) {
        const rect = gameCanvas.getBoundingClientRect();
        return clientX - rect.left;
    }

    // タッチ＆マウス操作
    gameCanvas.addEventListener("mousemove", (e) => {
        if (!isGameStarted && !isGameOver && !isGameClear) return;
        const relX = getRelativeX(e.clientX);
        if (relX > 0 && relX < gameCanvas.width) {
            paddleX = relX - paddleWidth / 2;
        }
    });

    gameCanvas.addEventListener("touchmove", (e) => {
        e.preventDefault(); // スクロール防止
        const relX = getRelativeX(e.touches[0].clientX);
        if (relX > 0 && relX < gameCanvas.width) {
            paddleX = relX - paddleWidth / 2;
        }
    }, { passive: false });

    const handleGameStart = (e) => {
        if (isRespawning || isPaused) return;
        if (!isGameStarted && !isGameOver && !isGameClear && !isShowingEndMessage) {
            isGameStarted = true;
        }
    };

    const handleOverlayDismiss = (e) => {
        if (isRespawning || isPaused) return;
        if (isShowingEndMessage) {
            isShowingEndMessage = false;
            if (isGameClear) {
                if (!isDebugMode) handleGameEnd(true);
                else startGame(currentStage);
            } else {
                if (!isDebugMode) {
                    if (gameMode === 'extra') handleGameEnd(false);
                    else {
                        bgmAudio.pause();
                        document.getElementById('continue-overlay').classList.add('active');
                    }
                } else startGame(currentStage);
            }
        }
    };

    gameCanvas.addEventListener("click", handleOverlayDismiss);
    gameCanvas.addEventListener("mousedown", handleGameStart);
    gameCanvas.addEventListener("touchstart", handleGameStart, { passive: true });
    gameCanvas.addEventListener("touchmove", handleGameStart, { passive: true });

    function getRemainingBlocks() {
        let count = 0;
        for (let c = 0; c < blockColumnCount; c++) {
            for (let r = 0; r < blockRowCount; r++) {
                if (blocks[c][r].status === 1) count++;
            }
        }
        return count;
    }

    // 描画部 - ブロックの描画（透過と切り抜き）
    function drawBlocks(remainingBlocks) {
        // 画像が無くても描画ループを止めないように変更

        const canvasW = gameCanvas.width;
        // 画像は上部 2:3 の領域を占める
        const imageHeight = canvasW * (3 / 2);

        // 壊れたプロックの割合（罫線の透明度計算用）
        const totalBlocks = blockColumnCount * blockRowCount;
        const strokeOpacity = Math.min(1, Math.max(0, (totalBlocks - remainingBlocks) / totalBlocks));

        // 復活中（ミス後・コンティニュー後）のフェードイン演出のベース秒数
        let elapsed = 0;
        if (isRespawning) {
            elapsed = Date.now() - respawnStartTime;
            if (elapsed >= 1000) {
                // フェードイン終了時にフラグをリセット（ブロック個別のisNewを消す）
                isRespawning = false;
                for (let c = 0; c < blockColumnCount; c++) {
                    for (let r = 0; r < blockRowCount; r++) {
                        blocks[c][r].isNew = false;
                    }
                }
            }
        }

        gameCtx.save();

        const hasImg = fgImg.complete && fgImg.naturalWidth > 0;

        if (remainingBlocks === totalBlocks && (hasImg || COLOR_BLIND_MODE)) {
            gameCtx.globalAlpha = isRespawning ? Math.min(1.0, elapsed / 1000) : 1.0;
            if (hasImg && !COLOR_BLIND_MODE) {
                gameCtx.drawImage(fgImg, 0, 0, fgImg.naturalWidth, fgImg.naturalHeight, 0, 0, canvasW, imageHeight);
            } else if (COLOR_BLIND_MODE) {
                gameCtx.fillStyle = '#1e90ff';
                gameCtx.fillRect(0, 0, canvasW, imageHeight);
            }
            gameCtx.globalAlpha = 1.0;
            gameCtx.restore();
            return;
        }

        for (let c = 0; c < blockColumnCount; c++) {
            for (let r = 0; r < blockRowCount; r++) {
                let b = blocks[c][r];
                if (b.status === 1) {
                    let bX = b.x;
                    let bY = b.y;

                    // 個別の不透明度計算
                    let currentOpacity = 1.0;
                    if (isRespawning && b.isNew) {
                        currentOpacity = Math.min(1.0, elapsed / 1000);
                    }
                    gameCtx.globalAlpha = currentOpacity;

                    if (remainingBlocks <= 30 || !hasImg || (COLOR_BLIND_MODE && remainingBlocks < totalBlocks)) {
                        // ブロックの残りが30個以下の場合は画像の代わりに青いブロックにする（ロード未完了時や色覚サポート有効時も同様）
                        gameCtx.fillStyle = '#1e90ff';
                        gameCtx.fillRect(bX, bY, blockWidth + 0.5, blockHeight + 0.5);
                        if (strokeOpacity > 0) {
                            gameCtx.strokeStyle = "rgba(255, 255, 255, 0.5)";
                            gameCtx.lineWidth = 1;
                            gameCtx.strokeRect(bX, bY, blockWidth, blockHeight);
                        }
                    } else {
                        // 画像領域に対するブロックの相対位置を計算
                        const srcX = (bX / canvasW) * fgImg.naturalWidth;
                        const srcY = (bY / imageHeight) * fgImg.naturalHeight;
                        const srcW = (blockWidth / canvasW) * fgImg.naturalWidth;
                        const srcH = (blockHeight / imageHeight) * fgImg.naturalHeight;

                        // 画像の一部を切り出して描画
                        gameCtx.drawImage(fgImg, srcX, srcY, srcW, srcH, bX, bY, blockWidth + 0.5, blockHeight + 0.5);

                        // ブロックが破壊されるほど罫線の透明度が下がる（濃くなる）ように
                        if (strokeOpacity > 0) {
                            gameCtx.strokeStyle = `rgba(0, 0, 0, ${strokeOpacity})`;
                            gameCtx.lineWidth = 1;
                            gameCtx.strokeRect(bX, bY, blockWidth, blockHeight);
                        }
                    }
                }
            }
        }
        gameCtx.restore();
    }

    function drawPaddle() {
        gameCtx.beginPath();
        if (gameCtx.roundRect) {
            gameCtx.roundRect(paddleX, paddleY, paddleWidth, paddleHeight, parseInt(paddleHeight) / 2);
        } else {
            gameCtx.rect(paddleX, paddleY, paddleWidth, paddleHeight);
        }
        gameCtx.fillStyle = "#ffffff";
        gameCtx.fill();
        gameCtx.closePath();
    }

    function drawBalls() {
        let opacity = 1.0;
        if (isRespawning) {
            let elapsed = Date.now() - respawnStartTime;
            if (elapsed >= 1000) {
                isRespawning = false;
            } else {
                opacity = elapsed / 1000;
            }
        }

        balls.forEach(ball => {
            gameCtx.globalAlpha = opacity;
            gameCtx.beginPath();
            gameCtx.arc(ball.x, ball.y, ball.radius, 0, Math.PI * 2);
            gameCtx.fillStyle = "#ffeb3b";
            gameCtx.fill();
            gameCtx.lineWidth = 1;
            gameCtx.strokeStyle = "#444";
            gameCtx.stroke();
            gameCtx.closePath();
            gameCtx.globalAlpha = 1.0;
        });
    }

    function collisionDetection(ball) {
        let hitOccurred = false;

        for (let c = 0; c < blockColumnCount; c++) {
            for (let r = 0; r < blockRowCount; r++) {
                let b = blocks[c][r];
                if (b.status === 1) {
                    if (ball.x + ball.radius > b.x && ball.x - ball.radius < b.x + blockWidth &&
                        ball.y + ball.radius > b.y && ball.y - ball.radius < b.y + blockHeight) {

                        // --- 安全な衝突方向の計算 ---
                        const prevX = ball.x - ball.dx;
                        const prevY = ball.y - ball.dy;
                        let hitX = false;
                        let hitY = false;

                        if (prevX + ball.radius <= b.x || prevX - ball.radius >= b.x + blockWidth) {
                            hitX = true;
                        }
                        if (prevY + ball.radius <= b.y || prevY - ball.radius >= b.y + blockHeight) {
                            hitY = true;
                        }

                        if (!hitX && !hitY) {
                            hitX = true; hitY = true;
                        }

                        b.status = 0;
                        score += 10;
                        hitOccurred = true;
                        playSE("assets/キャンセル音_4.wav");

                        // アイテムドロップ抽選 (※EXTRAモードではドロップなし)
                        if (gameMode !== 'extra' && Math.random() < ITEM_DROP_RATE / 100) {
                            dropItem(b.x + blockWidth / 2, b.y + blockHeight / 2);
                        }

                        if (hitX && !hitY) {
                            ball.dx = -ball.dx;
                        } else if (hitY && !hitX) {
                            ball.dy = -ball.dy;
                        } else {
                            ball.dx = -ball.dx;
                            ball.dy = -ball.dy;
                        }
                        return true; // 1衝突で戻る
                    }
                }
            }
        }
        return false;
    }

    function handleGameEnd(isClear) {
        if (animationId) cancelAnimationFrame(animationId);
        // スコア・ポイント計算
        // 倍率計算は残機（ミス回数）およびゲーム結果に基づいて決定
        let multiplier = 1.0;
        if (!isClear) {
            multiplier = 0.5;
        } else {
            if (missCount === 0) multiplier = 3.5;
            else if (missCount === 1) multiplier = 2.5;
            else if (missCount === 2) multiplier = 1.5;
            else multiplier = 1.0;
        }
        let earnedPoints = score * multiplier;

        // ポイント獲得倍率を適用 (100% = 1.0)
        earnedPoints = Math.floor(earnedPoints * (POINTS_BONUS_RATE / 100));

        totalPoints += earnedPoints;
        try {
            localStorage.setItem('breakout_points', totalPoints.toString());
        } catch (e) {
            console.warn("localStorage is restricted.", e);
        }
        updatePointsUI();

        const resultMsg = document.getElementById('result-message');
        const resultStats = document.getElementById('result-stats');
        const nextBtn = document.getElementById('go-to-bonus');
        const backBtn = document.getElementById('back-from-result-over');

        if (isClear) {
            resultMsg.textContent = "STAGE CLEAR!";
            resultMsg.style.color = "#32ff32";
            nextBtn.style.display = "inline-block";
            backBtn.style.display = "none";
        } else {
            resultMsg.textContent = "GAME OVER";
            resultMsg.style.color = "#ff3232";
            nextBtn.style.display = "none";
            backBtn.style.display = "inline-block";
        }

        resultStats.innerHTML = `
            獲得スコア: ${score} <br>
            ミス回数: ${missCount} (${missCount + totalMissCountOffset})回 <br>
        残機ボーナス: x${multiplier} <br>
        獲得倍率ボーナス: ${POINTS_BONUS_RATE.toFixed(1)}% <br>
            <span style="color:#ffcc00; font-size:2rem; font-weight:bold; display:block; margin-top:20px;">獲得ポイント: +${earnedPoints} pt</span>
        `;

        showScreen('result');

        // BGMを停止
        bgmAudio.pause();

        // ポーズを解除しておく（念のため）
        isPaused = false;

        // クリア時のみ、やめるボタンを隠す
        if (isClear) {
            document.getElementById('quit-game').style.display = 'none';

            // クリア情報を保存
            if (gameMode === 'extra') {
                if (!clearedExtraStages.includes(currentStage)) {
                    clearedExtraStages.push(currentStage);
                    saveClears();
                }
            } else {
                if (!clearedNormalStages.includes(currentStage)) {
                    clearedNormalStages.push(currentStage);
                    saveClears();
                }
            }
        }
    }

    function generateBonusChoices() {
        const container = document.getElementById('bonus-options-container');
        container.innerHTML = '';

        const allChoices = [
            { id: 'restore', title: 'ブロック復活量', val: '-0.6%', type: 'restore', isMaxed: () => BLOCK_RESTORE_RATE <= 0 },
            { id: 'laser', title: 'レーザー準備時間', val: '-5.0s', type: 'laser', isMaxed: () => LASER_CHARGE_TIME <= 10.0 },
            { id: 'points', title: 'ポイント獲得倍率', val: '+3.0%', type: 'points', isMaxed: () => POINTS_BONUS_RATE >= 150.0 },
            { id: 'item', title: 'アイテムドロップ率', val: '+0.4%', type: 'item', isMaxed: () => ITEM_DROP_RATE >= 10.0 },
            { id: 'ad', title: 'コマーシャル頻度', val: '-5.0%', type: 'ad', isMaxed: () => AD_FREQUENCY <= 0 }
        ];

        // まだ最大になっていないものだけをフィルタリング
        const availableChoices = allChoices.filter(c => !c.isMaxed());

        if (availableChoices.length === 0) {
            // 全て最大ならスキップ（本来ここに来る前に判定して画面遷移を止めるべきだがセーフティとして）
            showScreen('stageSelect');
            return;
        }

        // ランダムにシャッフルして、残り数に応じた選択肢数を出す
        const shuffled = availableChoices.sort(() => 0.5 - Math.random());
        const displayCount = Math.min(3, shuffled.length);
        const selected = shuffled.slice(0, displayCount);

        selected.forEach(choice => {
            const card = document.createElement('div');
            card.className = 'bonus-card';
            card.innerHTML = `
                <h3>${choice.title}</h3>
                <p class="bonus-val">${choice.val}</p>
                <button class="bonus-select-btn" data-type="${choice.type}">獲得する</button>
            `;
            container.appendChild(card);
        });

        // 4つ以上最大（残り1つ以下）または選択肢が極端に少ない場合は広告ボタンを出さない
        if (availableChoices.length > 1) {
            const premiumCard = document.createElement('div');
            premiumCard.className = 'bonus-card premium';
            premiumCard.innerHTML = `
                <div class="premium-badge">AD</div>
                <h3>全特典を解放</h3>
                <p class="bonus-val">表示された${selected.length}つの特典を全て獲得！</p>
                <button class="bonus-select-btn all" data-type="all">広告を見て獲得</button>
            `;
            container.appendChild(premiumCard);
        }

        // 動的に追加したボタンにイベントをつけ直す
        const btns = container.querySelectorAll('.bonus-select-btn');
        btns.forEach(btn => {
            btn.addEventListener('click', onBonusClick);
        });

        updateBonusButtons();
    }

    async function onBonusClick(e) {
        const type = e.currentTarget.getAttribute('data-type');
        if (type === 'all') {
            // 表示されている3つのタイプを特定して適用（今回は簡略化のため、全タイプに適用する処理を呼び出すが、本来は表示分のみ）
            // ユーザー要望: 「その時表示された上3つの選択肢を獲得する」
            const container = document.getElementById('bonus-options-container');
            const types = Array.from(container.querySelectorAll('.bonus-select-btn:not(.all)')).map(b => b.getAttribute('data-type'));

            alert("広告を視聴しています...（デモ）");
            setTimeout(() => {
                types.forEach(t => applyBonus(t, false)); // 二次引数で画面遷移を抑制
                updateParamsUI();
                showScreen('stageSelect');
            }, 1000);
        } else {
            applyBonus(type, true);
        }
    }

    function draw() {
        if (isGalleryActive) return; // ギャラリー表示中はゲームの描画ループを停止
        if (isPaused) {
            animationId = requestAnimationFrame(draw);
            return;
        }
        // 残りブロックなどの状態計算
        const remainingBlocks = getRemainingBlocks();
        const totalBlocks = blockColumnCount * blockRowCount;
        const brokenBlocks = totalBlocks - remainingBlocks;

        if (remainingBlocks === 0) {
            isGameClear = true;
        }

        // キャンバスのクリア（透明になるためbgCanvasが見える）
        gameCtx.clearRect(0, 0, gameCanvas.width, gameCanvas.height);

        // 全体を黒背景で塗りつぶす（画面下部のパドルエリア用）
        bgCtx.fillStyle = '#000';
        bgCtx.fillRect(0, 0, bgCanvas.width, bgCanvas.height);

        // bgCanvasの描画（背景画像を上部の 3:4 領域にのみ描画）
        if (bgImg.complete && bgImg.naturalWidth > 0) {
            const imageHeight = bgCanvas.width * (3 / 2);

            // ブロックの破壊割合に応じて背景の透明度を変更 (初期15%から開始)
            const opacity = 0.15 + (0.85 * (brokenBlocks / totalBlocks));
            bgCtx.globalAlpha = Math.min(1, opacity);

            bgCtx.drawImage(bgImg, 0, 0, bgCanvas.width, imageHeight);
            bgCtx.globalAlpha = 1.0; // リセット
        }


        drawBlocks(remainingBlocks);
        drawPaddle();
        drawBalls();
        drawLaser();
        drawItems();
        drawPenetratingBalls();
        drawBarrier();

        if (isDebugMode) {
            gameCtx.beginPath();
            gameCtx.strokeStyle = "#ff0000"; // 赤に変える
            gameCtx.lineWidth = 3;
            gameCtx.moveTo(0, gameCanvas.height - 2);
            gameCtx.lineTo(gameCanvas.width, gameCanvas.height - 2);
            gameCtx.stroke();
            gameCtx.closePath();
        }

        // 残機UIHUD 行1: life + レーザーバー
        gameCtx.font = "bold 13px sans-serif";
        gameCtx.fillStyle = "#fff";
        gameCtx.textAlign = "left";
        gameCtx.fillText("life:", 10, gameCanvas.height - 36);

        // ボールアイコン
        for (let i = 0; i < lives; i++) {
            gameCtx.beginPath();
            gameCtx.arc(52 + (i * 16), gameCanvas.height - 41, ballRadius * 0.8, 0, Math.PI * 2);
            gameCtx.fillStyle = "#ffeb3b";
            gameCtx.fill();
            gameCtx.lineWidth = 1;
            gameCtx.strokeStyle = "#444";
            gameCtx.stroke();
            gameCtx.closePath();
        }

        // HUD 行2: スコア
        gameCtx.font = "bold 13px sans-serif";
        gameCtx.fillStyle = "#fff";
        gameCtx.textAlign = "left";
        gameCtx.fillText(`score: ${score}`, 10, gameCanvas.height - 12);

        // レーザーチャージバー
        drawLaserChargeBar();

        if (isGameOver || isGameClear) {
            if (!isShowingEndMessage) {
                isShowingEndMessage = true;
                isGameStarted = false;
            }
            // 半透明オーバーレイ
            gameCtx.fillStyle = 'rgba(0,0,0,0.65)';
            gameCtx.fillRect(0, 0, gameCanvas.width, gameCanvas.height);

            const msgText = isGameClear ? 'CLEAR!' : 'GAME OVER';
            const msgColor = isGameClear ? '#32ff32' : '#ff3232';
            gameCtx.font = `bold ${Math.floor(gameCanvas.width * 0.13)}px sans-serif`;
            gameCtx.fillStyle = msgColor;
            gameCtx.textAlign = 'center';
            gameCtx.textBaseline = 'middle';
            gameCtx.fillText(msgText, gameCanvas.width / 2, gameCanvas.height * 0.38);

            gameCtx.font = `bold ${Math.floor(gameCanvas.width * 0.062)}px sans-serif`;
            gameCtx.fillStyle = '#ffffff';
            gameCtx.fillText('タップして続ける', gameCanvas.width / 2, gameCanvas.height * 0.52);

            if (isDebugMode) {
                gameCtx.font = `bold ${Math.floor(gameCanvas.width * 0.05)}px sans-serif`;
                gameCtx.fillStyle = '#00ff00';
                gameCtx.fillText('[DEBUG MODE]', gameCanvas.width / 2, gameCanvas.height * 0.62);
            }

            gameCtx.textBaseline = 'alphabetic';
            animationId = requestAnimationFrame(draw);
            return;
        }

        if (isGameStarted) {
            // レーザー充電時間の更新 (EXTRAモードでは無効化)
            const nowMs = Date.now();
            if (gameMode !== 'extra' && laserLastFrameTime !== null) {
                laserChargeAccumulated += nowMs - laserLastFrameTime;
            }
            laserLastFrameTime = nowMs;

            // 充電完了でレーザー自動発射 (EXTRAモードでは無効化)
            if (gameMode !== 'extra' && !isLaserFiring && laserChargeAccumulated >= LASER_CHARGE_TIME * 1000) {
                fireLaser();
            }

            const paddleSpeed = gameCanvas.width * 0.02; // 相対的なパドル速度
            if (rightPressed && paddleX < gameCanvas.width - paddleWidth) {
                paddleX += paddleSpeed;
            } else if (leftPressed && paddleX > 0) {
                paddleX -= paddleSpeed;
            }

            // ボールの移動と衝突判定
            for (let i = balls.length - 1; i >= 0; i--) {
                let ball = balls[i];

                // 速度補正
                const breakRatio = Math.min(1, brokenBlocks / (totalBlocks * 0.75));
                const minSpeed = speedBase * 0.60;
                // EXTRAモードでは最高速度を1.5倍にする（通常は0.8）
                const maxSpeed = (gameMode === 'extra') ? (minSpeed * 1.5) : (speedBase * 0.8);
                const targetSpeed = minSpeed + (maxSpeed - minSpeed) * breakRatio;

                const cv = Math.sqrt(ball.dx * ball.dx + ball.dy * ball.dy);
                if (cv > 0 && Math.abs(cv - targetSpeed) > 0.01) {
                    const scale = targetSpeed / cv;
                    ball.dx *= scale;
                    ball.dy *= scale;
                }

                // 次のフレーム予測
                let nextX = ball.x + ball.dx;
                let nextY = ball.y + ball.dy;

                // 壁の反射（左右）
                if (nextX > gameCanvas.width - ball.radius || nextX < ball.radius) {
                    ball.dx = -ball.dx;
                    playSE("assets/タップ音.mp3");
                }
                // 壁の反射（上）
                if (nextY < ball.radius) {
                    ball.dy = -ball.dy;
                    playSE("assets/タップ音.mp3");
                } else if (nextY > paddleY - ball.radius && nextY < paddleY + paddleHeight) {
                    // パドルとの衝突判断
                    if (ball.x > paddleX && ball.x < paddleX + paddleWidth) {
                        ball.dy = -Math.abs(ball.dy);
                        // 当たった場所によって角度を変える（反射を少し垂直寄りに：0.3 -> 0.2）
                        let deltaX = ball.x - (paddleX + paddleWidth / 2);
                        ball.dx = deltaX * 0.2;
                        // めり込み防止：パドルの直上に配置
                        ball.y = paddleY - ball.radius;
                        playSE("assets/タップ音.mp3");
                    }
                } else if (nextY > gameCanvas.height - ball.radius) {
                    if (isDebugMode) {
                        ball.dy = -Math.abs(ball.dy);
                        ball.y = gameCanvas.height - ball.radius;
                        playSE("assets/タップ音.mp3");
                    } else if (nextY > gameCanvas.height + ball.radius) {
                        // ボールを失う
                        balls.splice(i, 1);
                        continue;
                    }
                }

                ball.x += ball.dx;
                ball.y += ball.dy;

                collisionDetection(ball);
            }

            // 全てのボールを失った場合
            if (balls.length === 0) {
                missCount++;
                penetratingBalls = [];
                items = [];
                hasBarrier = false;

                if (lives > 0) {
                    lives--;
                    isGameStarted = false;
                    isRespawning = true;
                    respawnStartTime = Date.now();

                    // --- 破壊したブロックを一部復活させる ---
                    let resRate = (gameMode === 'extra') ? 0.15 : BLOCK_RESTORE_RATE;
                    // すべての壊れたブロックをリストアップ
                    let brokenOnes = [];
                    for (let c = 0; c < blockColumnCount; c++) {
                        for (let r = 0; r < blockRowCount; r++) {
                            if (blocks[c][r].status === 0) brokenOnes.push(blocks[c][r]);
                        }
                    }
                    // 指定確率で復活
                    let restoreCount = Math.floor(brokenOnes.length * resRate);
                    brokenOnes.sort(() => Math.random() - 0.5);
                    for (let i = 0; i < restoreCount && i < brokenOnes.length; i++) {
                        brokenOnes[i].status = 1;
                        brokenOnes[i].isNew = true;
                    }

                    initBallsAfterMiss();
                } else {
                    isGameOver = true;
                    isGameStarted = false;
                }
            }
        } else {
            laserLastFrameTime = null; // ゲーム停止中は計測をリセット
            // ゲーム開始前はパドルの中心にボールを追従
            if (balls.length > 0) {
                balls.forEach((ball, idx) => {
                    ball.x = paddleX + paddleWidth / 2 + (idx * 2); // 複数時は少しずらす
                    ball.y = paddleY - ball.radius;
                });
            }
        }

        animationId = requestAnimationFrame(draw);
    }

    // レーザーを発射する処理
    function fireLaser() {
        laserFireX = paddleX + paddleWidth / 2;
        isLaserFiring = true;
        laserFireTime = Date.now();
        laserChargeAccumulated = 0;
        laserLastFrameTime = Date.now();

        // 下の行から上の行へチェック、最大10ブロック破壊（9貫通）
        let hitCount = 0;
        const maxHits = 10;
        for (let r = blockRowCount - 1; r >= 0 && hitCount < maxHits; r--) {
            for (let c = 0; c < blockColumnCount; c++) {
                if (blocks[c][r].status === 1) {
                    if (laserFireX >= blocks[c][r].x && laserFireX < blocks[c][r].x + blockWidth) {
                        const bX = blocks[c][r].x;
                        const bY = blocks[c][r].y;
                        blocks[c][r].status = 0;
                        score += 10;
                        playSE("assets/キャンセル音_4.wav");

                        // レーザー貫通時もアイテムドロップ抽選 (※EXTRAモードではドロップなし)
                        if (gameMode !== 'extra' && Math.random() < ITEM_DROP_RATE / 100) {
                            dropItem(bX + blockWidth / 2, bY + blockHeight / 2);
                        }

                        hitCount++;
                        break;
                    }
                }
            }
        }
    }

    // レーザービームの描画
    function drawLaser() {
        if (!isLaserFiring) return;
        const elapsed = Date.now() - laserFireTime;
        if (elapsed >= LASER_DURATION) {
            isLaserFiring = false;
            return;
        }
        const opacity = 1 - elapsed / LASER_DURATION;
        const x = laserFireX;

        // 外側のグロー
        gameCtx.beginPath();
        gameCtx.moveTo(x, paddleY);
        gameCtx.lineTo(x, 0);
        gameCtx.strokeStyle = `rgba(0, 200, 255, ${opacity * 0.3})`;
        gameCtx.lineWidth = 14;
        gameCtx.stroke();

        // 中間のグロー
        gameCtx.beginPath();
        gameCtx.moveTo(x, paddleY);
        gameCtx.lineTo(x, 0);
        gameCtx.strokeStyle = `rgba(100, 230, 255, ${opacity * 0.6})`;
        gameCtx.lineWidth = 6;
        gameCtx.stroke();

        // 芯
        gameCtx.beginPath();
        gameCtx.moveTo(x, paddleY);
        gameCtx.lineTo(x, 0);
        gameCtx.strokeStyle = `rgba(255, 255, 255, ${opacity})`;
        gameCtx.lineWidth = 2;
        gameCtx.stroke();
    }

    // レーザーチャージバーの描画（life行と同じ上段に配置）
    function drawLaserChargeBar() {
        const chargePercent = (gameMode === 'extra') ? 0 : Math.min(100, (laserChargeAccumulated / (LASER_CHARGE_TIME * 1000)) * 100);
        const cw = gameCanvas.width;
        const ch = gameCanvas.height;

        // life表示（上段 y=ch-36〜ch-41）に合わせたY位置
        const barH = 14;
        const barY = ch - 48;
        const labelX = cw * 0.38;
        const barX = cw * 0.54;
        const barW = cw * 0.43;
        const isReady = (gameMode !== 'extra') && chargePercent >= 100;

        // ラベル「POWER」
        gameCtx.font = "bold 11px sans-serif";
        gameCtx.fillStyle = (gameMode === 'extra') ? "#666" : (isReady ? "#ff0000" : "#ff4444");
        gameCtx.textAlign = "left";
        gameCtx.textBaseline = "middle";
        gameCtx.fillText((gameMode === 'extra') ? "POWER (OFF)" : "POWER", labelX, barY + barH / 2);

        // 枠線
        gameCtx.strokeStyle = "#888";
        gameCtx.lineWidth = 1;
        gameCtx.strokeRect(barX, barY, barW, barH);

        // 中身
        gameCtx.fillStyle = (gameMode === 'extra') ? "#666" : (isReady ? "#ff0000" : "#ff4444");
        gameCtx.fillRect(barX, barY, barW * (chargePercent / 100), barH);

        // %テキスト
        gameCtx.font = "bold 9px sans-serif";
        gameCtx.fillStyle = "#fff";
        gameCtx.textAlign = "center";
        gameCtx.fillText((gameMode === 'extra') ? "OFF" : `${Math.floor(chargePercent)}%`, barX + barW / 2, barY + barH / 2);
        gameCtx.textBaseline = "alphabetic";
    }

    // ステージ選択画面のパラメータ表示を更新
    function updateParamsUI() {
        const restoreEl = document.getElementById('param-restore-value');
        const laserEl = document.getElementById('param-laser-value');
        const bonusEl = document.getElementById('param-bonus-value');
        const adEl = document.getElementById('param-ad-value');
        const itemEl = document.getElementById('param-item-value');

        if (restoreEl) {
            let resVal = (gameMode === 'extra') ? 0.15 : BLOCK_RESTORE_RATE;
            restoreEl.textContent = (resVal * 100).toFixed(1);
            if (gameMode === 'extra') restoreEl.classList.add('extra-red');
            else restoreEl.classList.remove('extra-red');
        }
        if (laserEl) {
            if (gameMode === 'extra') {
                laserEl.textContent = "使用不能";
                laserEl.classList.add('extra-red');
            } else {
                laserEl.textContent = LASER_CHARGE_TIME.toFixed(1);
                laserEl.classList.remove('extra-red');
            }
        }
        if (itemEl) {
            let dropVal = (gameMode === 'extra') ? 0.0 : ITEM_DROP_RATE;
            itemEl.textContent = dropVal.toFixed(1);
            if (gameMode === 'extra') itemEl.classList.add('extra-red');
            else itemEl.classList.remove('extra-red');
        }

        if (bonusEl) {
            bonusEl.textContent = POINTS_BONUS_RATE.toFixed(1);
            bonusEl.classList.remove('extra-red'); // 常に青
        }
        if (adEl) {
            adEl.textContent = AD_FREQUENCY.toFixed(1);
            adEl.classList.remove('extra-red'); // 常に青
        }

        // EXTRAモード時の警告表示制御
        const paramLabels = ['restore', 'item', 'laser'];
        paramLabels.forEach(label => {
            const container = document.getElementById(`param-${label}-value`).parentElement;
            let warning = container.querySelector('.extra-warning');

            // 単位（%や秒）の取得
            const unitSpan = container.querySelector('.unit');

            if (gameMode === 'extra') {
                if (!warning) {
                    warning = document.createElement('span');
                    warning.className = 'extra-warning';
                    warning.style.color = '#ff3232'; // 警告は赤色に
                    warning.textContent = '強化が一時無効化されます';
                    container.appendChild(warning);
                }
                // レーザーの単位「秒」を消す
                if (label === 'laser' && unitSpan) {
                    unitSpan.style.display = 'none';
                }
            } else {
                if (warning) warning.remove();
                if (unitSpan) unitSpan.style.display = 'inline';
            }
        });

        // 最大強化ラベルの表示制御
        const maxRestore = document.getElementById('max-restore-label');
        const maxLaser = document.getElementById('max-laser-label');
        const maxBonus = document.getElementById('max-bonus-label');
        const maxAd = document.getElementById('max-ad-label');
        const maxItem = document.getElementById('max-item-label');

        // 警告（強化無効化）が出ている間は「最大強化！」を隠す
        if (maxRestore) maxRestore.style.display = (BLOCK_RESTORE_RATE <= 0 && gameMode !== 'extra') ? 'inline-block' : 'none';
        if (maxLaser) maxLaser.style.display = (LASER_CHARGE_TIME <= 10.0 && gameMode !== 'extra') ? 'inline-block' : 'none';
        if (maxItem) maxItem.style.display = (ITEM_DROP_RATE >= 10.0 && gameMode !== 'extra') ? 'inline-block' : 'none';

        // ボーナスとAD頻度は常に条件どおり
        if (maxBonus) maxBonus.style.display = (POINTS_BONUS_RATE >= 150.0) ? 'inline-block' : 'none';
        if (maxAd) maxAd.style.display = (AD_FREQUENCY <= 0) ? 'inline-block' : 'none';

        updateBonusButtons();
    }

    function updateBonusButtons() {
        const btnRestore = document.querySelector('.bonus-select-btn[data-type="restore"]');
        const btnLaser = document.querySelector('.bonus-select-btn[data-type="laser"]');
        const btnBonus = document.querySelector('.bonus-select-btn[data-type="points"]');
        const btnAd = document.querySelector('.bonus-select-btn[data-type="ad"]');
        const btnItem = document.querySelector('.bonus-select-btn[data-type="item"]');

        if (btnRestore) btnRestore.disabled = (BLOCK_RESTORE_RATE <= 0);
        if (btnLaser) btnLaser.disabled = (LASER_CHARGE_TIME <= 10.0);
        if (btnBonus) btnBonus.disabled = (POINTS_BONUS_RATE >= 100.0);
        if (btnAd) btnAd.disabled = (AD_FREQUENCY <= 0);
        if (btnItem) btnItem.disabled = (ITEM_DROP_RATE >= 10.0);

        if (btnRestore && btnRestore.disabled) btnRestore.textContent = "最大強化済み";
        if (btnLaser && btnLaser.disabled) btnLaser.textContent = "最大強化済み";
        if (btnBonus && btnBonus.disabled) btnBonus.textContent = "最大強化済み";
        if (btnAd && btnAd.disabled) btnAd.textContent = "最大強化済み";
        if (btnItem && btnItem.disabled) btnItem.textContent = "最大強化済み";
    }

    function applyBonus(type, followThrough) {
        if (type === 'restore') {
            BLOCK_RESTORE_RATE = Math.max(0, BLOCK_RESTORE_RATE - 0.006);
            localStorage.setItem('breakout_restore_rate', BLOCK_RESTORE_RATE.toString());
        }
        if (type === 'laser') {
            LASER_CHARGE_TIME = Math.max(10.0, LASER_CHARGE_TIME - 5.0);
            localStorage.setItem('breakout_laser_time', LASER_CHARGE_TIME.toString());
        }
        if (type === 'points') {
            POINTS_BONUS_RATE = Math.min(150.0, POINTS_BONUS_RATE + 3.0);
            localStorage.setItem('breakout_points_bonus', POINTS_BONUS_RATE.toString());
        }
        if (type === 'ad') {
            AD_FREQUENCY = Math.max(0, AD_FREQUENCY - 5.0);
            localStorage.setItem('breakout_ad_freq', AD_FREQUENCY.toString());
        }
        if (type === 'item') {
            ITEM_DROP_RATE = Math.min(10.0, ITEM_DROP_RATE + 0.4);
            localStorage.setItem('breakout_item_drop', ITEM_DROP_RATE.toString());
        }

        if (followThrough) {
            updateParamsUI();
            showScreen('stageSelect');
        }
    }

    function dropItem(x, y) {
        let rand = Math.random();
        let type = ITEM_TYPES.ENERGY_BOX;
        if (rand < 0.75) type = ITEM_TYPES.ENERGY_BOX;
        else if (rand < 0.90) type = ITEM_TYPES.PENETRATE;
        else type = ITEM_TYPES.BARRIER;
        items.push({ x: x - 10, y: y - 10, type: type, w: 20, h: 20 });
    }

    function drawItems() {
        for (let i = items.length - 1; i >= 0; i--) {
            let it = items[i];
            it.y += 2; // アイテム落下速度

            // 共通描画
            gameCtx.fillStyle = "#000";
            if (it.type === ITEM_TYPES.ENERGY_BOX) {
                // 白い縁の赤い正方形
                gameCtx.fillStyle = "#ff0000";
                gameCtx.strokeStyle = "#fff";
                gameCtx.lineWidth = 2;
                gameCtx.fillRect(it.x, it.y, it.w, it.h);
                gameCtx.strokeRect(it.x, it.y, it.w, it.h);

                // 白い「Ｐ」文字
                gameCtx.fillStyle = "#fff";
                gameCtx.font = "bold 14px sans-serif";
                gameCtx.textAlign = "center";
                gameCtx.textBaseline = "middle";
                gameCtx.fillText("Ｐ", it.x + it.w / 2, it.y + it.h / 2 + 1);
            } else {
                gameCtx.strokeStyle = it.type === ITEM_TYPES.BARRIER ? "#fff" : "#ff00ff";
                gameCtx.lineWidth = 2;
                gameCtx.strokeRect(it.x, it.y, it.w, it.h);
                gameCtx.fillRect(it.x, it.y, it.w, it.h);
            }

            if (it.type === ITEM_TYPES.PENETRATE) {
                // 赤紫（マゼンタ）ボール
                gameCtx.fillStyle = "#ff00ff";
                gameCtx.beginPath();
                gameCtx.arc(it.x + it.w / 2, it.y + it.h / 2, 6, 0, Math.PI * 2);
                gameCtx.fill();
            } else if (it.type === ITEM_TYPES.BARRIER) {
                // 緑の十字
                gameCtx.strokeStyle = "#33ff33";
                gameCtx.lineWidth = 3;
                gameCtx.beginPath();
                gameCtx.moveTo(it.x + 5, it.y + it.h / 2);
                gameCtx.lineTo(it.x + it.w - 5, it.y + it.h / 2);
                gameCtx.moveTo(it.x + it.w / 2, it.y + 5);
                gameCtx.lineTo(it.x + it.w / 2, it.y + it.h - 5);
                gameCtx.stroke();
            }

            // パドルとの衝突
            if (it.y + it.h > paddleY && it.y < paddleY + paddleHeight &&
                it.x + it.w > paddleX && it.x < paddleX + paddleWidth) {
                activateItem(it.type);
                items.splice(i, 1);
            } else if (it.y > gameCanvas.height) {
                items.splice(i, 1);
            }
        }
    }

    function activateItem(type) {
        if (type === ITEM_TYPES.ENERGY_BOX) {
            laserChargeAccumulated = Math.min(LASER_CHARGE_TIME * 1000, laserChargeAccumulated + (LASER_CHARGE_TIME * 1000 * 0.2));
        } else if (type === ITEM_TYPES.PENETRATE) {
            // 最低でも1つのブロックを破壊できるような方向に射出
            let dx = (Math.random() - 0.5) * 6;
            let dy = -6;

            let existingBlocks = [];
            for (let c = 0; c < blockColumnCount; c++) {
                for (let r = 0; r < blockRowCount; r++) {
                    if (blocks[c][r].status === 1) existingBlocks.push(blocks[c][r]);
                }
            }

            if (existingBlocks.length > 0) {
                const target = existingBlocks[Math.floor(Math.random() * existingBlocks.length)];
                const startX = paddleX + paddleWidth / 2;
                const startY = paddleY - 10;
                const diffX = (target.x + blockWidth / 2) - startX;
                const diffY = (target.y + blockHeight / 2) - startY;
                const dist = Math.sqrt(diffX * diffX + diffY * diffY);
                const speed = 6;
                dx = (diffX / dist) * speed;
                dy = (diffY / dist) * speed;
            }

            penetratingBalls.push({
                x: paddleX + paddleWidth / 2,
                y: paddleY - 10,
                dx: dx,
                dy: dy,
                radius: 6
            });
        } else if (type === ITEM_TYPES.BARRIER) {
            hasBarrier = true;
        }
    }

    function drawPenetratingBalls() {
        for (let i = penetratingBalls.length - 1; i >= 0; i--) {
            let p = penetratingBalls[i];
            p.x += p.dx;
            p.y += p.dy;

            // 壁反射
            if (p.x < p.radius || p.x > gameCanvas.width - p.radius) p.dx = -p.dx;
            if (p.y < p.radius) p.dy = -p.dy;

            // ブロック破壊
            for (let c = 0; c < blockColumnCount; c++) {
                for (let r = 0; r < blockRowCount; r++) {
                    let b = blocks[c][r];
                    if (b.status === 1) {
                        if (p.x + p.radius > b.x && p.x - p.radius < b.x + blockWidth &&
                            p.y + p.radius > b.y && p.y - p.radius < b.y + blockHeight) {
                            b.status = 0;
                            score += 10;
                            playSE("assets/キャンセル音_4.wav");

                            // 貫通弾からもアイテムドロップ (※EXTRAモードではドロップなし)
                            if (gameMode !== 'extra' && Math.random() < ITEM_DROP_RATE / 100) {
                                dropItem(b.x + blockWidth / 2, b.y + blockHeight / 2);
                            }
                            // 貫通弾は反射しない
                        }
                    }
                }
            }

            // 描画
            gameCtx.beginPath();
            gameCtx.arc(p.x, p.y, p.radius, 0, Math.PI * 2);
            gameCtx.fillStyle = "#ff00ff";
            gameCtx.shadowBlur = 10;
            gameCtx.shadowColor = "#ff00ff";
            gameCtx.fill();
            gameCtx.shadowBlur = 0;
            gameCtx.closePath();

            // 画面外（下）へ消える
            if (p.y > gameCanvas.height + 20) {
                penetratingBalls.splice(i, 1);
            }
        }
    }

    function drawBarrier() {
        if (!hasBarrier) return;
        gameCtx.fillStyle = "#33ff33";
        gameCtx.fillRect(0, gameCanvas.height - 5, gameCanvas.width, 5);

        // ボールとの衝突
        balls.forEach(ball => {
            if (ball.y + ball.radius > gameCanvas.height - 5) {
                ball.dy = -Math.abs(ball.dy);
                ball.y = gameCanvas.height - 5 - ball.radius;
                hasBarrier = false; // 1回で消失
                playSE("assets/タップ音.mp3");
            }
        });
    }

    function respawnBlocks() {
        for (let c = 0; c < blockColumnCount; c++) {
            for (let r = 0; r < blockRowCount; r++) {
                if (blocks[c][r].status === 0) {
                    if (Math.random() < BLOCK_RESTORE_RATE) {
                        blocks[c][r].status = 1;
                        blocks[c][r].isNew = true; // フェードイン対象フラグ
                    }
                }
            }
        }
    }

    function startGame(stageNumber) {
        if (animationId) cancelAnimationFrame(animationId);

        // ステージ開始時の広告抽選
        if (Math.random() < AD_FREQUENCY / 100) {
            alert("ステージ開始前に短い広告が挿入されます...（デモ）");
        }

        currentStage = stageNumber;
        isGameStarted = false;
        isGalleryActive = false; // ギャラリーを終了
        isGameOver = false;
        isGameClear = false;
        isPaused = false;
        hasBarrier = false;
        items = [];
        penetratingBalls = [];
        lives = 2; // 初期残機は2（本番設定）
        score = 0;
        missCount = 0;
        totalMissCountOffset = 0;
        isShowingEndMessage = false;

        document.getElementById('quit-game').style.display = 'inline-block';
        document.getElementById('quit-confirm-overlay').classList.remove('active');
        document.getElementById('continue-overlay').classList.remove('active');
        isDebugMode = false;
        debugKeyIndex = 0;
        isRespawning = false;
        laserChargeAccumulated = 0;
        laserLastFrameTime = null;
        isLaserFiring = false;
        showScreen('game');

        // UIのリセット
        document.getElementById('gallery-ui').style.display = 'none';
        document.getElementById('gallery-back').style.display = 'none';
        document.getElementById('game-ui').style.display = 'flex';
        document.getElementById('gallery-locked-overlay').style.display = 'none';

        // キャンバスのリサイズと初期化
        resizeCanvas();
        initGameConstants();

        // 画像の読み込み開始（非同期）
        bgImg.src = `assets/${stageNumber}a.png`;
        fgImg.src = `assets/${stageNumber}b.png`;

        // BGMの再生
        bgmAudio.currentTime = 0;
        bgmAudio.volume = BGM_VOLUME;
        bgmAudio.play().catch(e => console.warn("BGM play failed", e));

        // 描画ループ開始（画像ロード前から開始し、ロード完了次第画像が表示されるようにする）
        draw();
    }

    // ボタンにイベントをバインド
    updateParamsUI();
    document.getElementById('start-btn').addEventListener('click', () => showScreen('stageSelect'));
    document.getElementById('back-to-title').addEventListener('click', () => showScreen('title'));
    // 旧リザルトボタンは削除（ID変更のため）
    document.getElementById('quit-game').addEventListener('click', () => {
        isPaused = true;
        document.getElementById('quit-confirm-overlay').classList.add('active');
    });

    document.getElementById('quit-yes').addEventListener('click', () => {
        if (animationId) cancelAnimationFrame(animationId);
        document.getElementById('quit-confirm-overlay').classList.remove('active');
        bgmAudio.pause(); // BGM停止
        showScreen('stageSelect');
    });

    // プレイデータ初期化
    document.getElementById('data-reset-btn').addEventListener('click', () => {
        if (confirm("全てのプレイデータ（スコア、アンロック状況、強化ステータス）をリセットしますか？\nこの操作は取り消せません。")) {
            localStorage.clear();
            alert("データを初期化しました。再読み込みします。");
            location.reload();
        }
    });

    document.getElementById('quit-no').addEventListener('click', () => {
        isPaused = false;
        document.getElementById('quit-confirm-overlay').classList.remove('active');
    });

    // コンティニュー
    document.getElementById('continue-yes').addEventListener('click', () => {
        alert("広告を視聴しました！（コンティニュー）");
        totalMissCountOffset += missCount; // 現在のミスをオフセットに加算
        missCount = 0; // ミス回数をリセット
        lives = 2;
        respawnBlocks();
        isGameStarted = false;
        isGameOver = false;
        isShowingEndMessage = false;
        document.getElementById('continue-overlay').classList.remove('active');
        initBallsAfterMiss();

        // BGMを最初から再生
        bgmAudio.currentTime = 0;
        bgmAudio.play().catch(e => console.warn("BGM play failed", e));
    });

    document.getElementById('continue-no').addEventListener('click', () => {
        document.getElementById('continue-overlay').classList.remove('active');
        handleGameEnd(false);
    });

    // リザルトからの遷移
    document.getElementById('go-to-bonus').addEventListener('click', () => {
        // 全項目が最大強化済みならスキップ
        const isAllMaxed = (BLOCK_RESTORE_RATE <= 0) &&
            (LASER_CHARGE_TIME <= 10.0) &&
            (POINTS_BONUS_RATE >= 150.0) &&
            (ITEM_DROP_RATE >= 5.0) &&
            (AD_FREQUENCY <= 0);

        if (isAllMaxed) {
            showScreen('stageSelect');
        } else {
            generateBonusChoices();
            showScreen('bonus');
        }
    });
    document.getElementById('back-from-result-over').addEventListener('click', () => showScreen('stageSelect'));

    // ボーナス選択 (generateBonusChoicesでイベントは設定されるため、初期要素用のバインドのみ維持または削除)
    // 既存のbonusBtnsループは削除し、onBonusClickに集約（Step 397で実装済み）

    // モード選択ボタンの制御
    document.getElementById('mode-normal').addEventListener('click', () => {
        gameMode = 'normal';
        document.body.classList.remove('extra-active');
        updateModeButtons();
        updateParamsUI();
        renderStageSelect();
    });

    document.getElementById('mode-extra').addEventListener('click', () => {
        gameMode = 'extra';
        document.body.classList.add('extra-active');
        updateModeButtons();
        updateParamsUI();
        renderStageSelect();
    });

    document.getElementById('mode-gallery').addEventListener('click', () => {
        gameMode = 'gallery';
        document.body.classList.remove('extra-active');
        updateModeButtons();
        updateParamsUI();
        renderStageSelect();
    });

    // --- ギャラリーモード実装 ---
    function enterGallery(stageNum) {
        galleryTargetStage = stageNum; // 保存用
        isGalleryActive = true;
        galleryViewType = 'fg'; // デフォルトはブロック画像
        showScreen('game');

        // キャンバスのリサイズと初期化を確実に行う
        resizeCanvas();
        initGameConstants();

        // UI表示
        document.getElementById('gallery-ui').style.display = 'block';
        document.getElementById('gallery-back').style.display = 'block';
        document.getElementById('game-ui').style.display = 'none';

        // 画像の読み込みと描画
        let loaded = 0;
        const total = 2;
        const onLoad = () => {
            loaded++;
            if (loaded === total) drawGallery();
        };
        bgImg.onload = onLoad;
        fgImg.onload = onLoad;
        bgImg.src = `assets/${stageNum}a.png`;
        fgImg.src = `assets/${stageNum}b.png`;
    }

    function drawGallery() {
        if (!isGalleryActive) return;

        // 描画クリア
        bgCtx.fillStyle = '#000';
        bgCtx.fillRect(0, 0, bgCanvas.width, bgCanvas.height);
        gameCtx.clearRect(0, 0, gameCanvas.width, gameCanvas.height);

        const targetImg = (galleryViewType === 'fg') ? fgImg : bgImg;
        const isUnlocked = (galleryViewType === 'fg')
            ? (clearedNormalStages.includes(galleryTargetStage) || clearedExtraStages.includes(galleryTargetStage))
            : clearedExtraStages.includes(galleryTargetStage);

        // 背景画像Canvasに描画（ゲーム中と同じ 3:2 アスペクト比エリア）
        const imageHeight = bgCanvas.width * (3 / 2);
        bgCtx.save();
        if (!isUnlocked) bgCtx.globalAlpha = 0.5;
        bgCtx.drawImage(targetImg, 0, 0, bgCanvas.width, imageHeight);
        bgCtx.restore();

        // ロック中ならオーバーレイテキストを表示
        const overlay = document.getElementById('gallery-locked-overlay');
        const saveBtn = document.getElementById('gallery-save');
        if (!isUnlocked) {
            overlay.style.display = 'flex';
            const reason = (galleryViewType === 'fg')
                ? "対応するステージをクリアして下さい"
                : "対応するステージ（EXTRA）をクリアして下さい";
            document.getElementById('gallery-locked-reason').textContent = reason;
            saveBtn.disabled = true;
            saveBtn.style.opacity = '0.5';
        } else {
            overlay.style.display = 'none';
            saveBtn.disabled = false;
            saveBtn.style.opacity = '1';
        }
    }

    document.getElementById('gallery-toggle').addEventListener('click', () => {
        galleryViewType = (galleryViewType === 'fg' ? 'bg' : 'fg');
        drawGallery();
    });

    document.getElementById('gallery-save').addEventListener('click', () => {
        try {
            const suffix = (galleryViewType === 'fg' ? 'b' : 'a');
            const fileName = `${galleryTargetStage}${suffix}.png`;
            const filePath = `assets/${fileName}`;

            function fallbackDownload(url, name) {
                // WebView等でリンク保存が機能しない場合は長押し用の画像オーバーレイを表示
                const imgOverlay = document.createElement('div');
                imgOverlay.style.position = 'fixed';
                imgOverlay.style.top = '0';
                imgOverlay.style.left = '0';
                imgOverlay.style.width = '100vw';
                imgOverlay.style.height = '100vh';
                imgOverlay.style.backgroundColor = 'rgba(0,0,0,0.95)';
                imgOverlay.style.zIndex = '9999';
                imgOverlay.style.display = 'flex';
                imgOverlay.style.flexDirection = 'column';
                imgOverlay.style.justifyContent = 'center';
                imgOverlay.style.alignItems = 'center';

                const instruction = document.createElement('p');
                instruction.textContent = "タップで戻ります。";
                instruction.style.color = '#fff';
                instruction.style.margin = '20px';
                instruction.style.textAlign = 'center';

                const img = document.createElement('img');
                img.src = url;
                img.style.width = '100vw';
                img.style.height = 'auto';

                imgOverlay.appendChild(instruction);
                imgOverlay.appendChild(img);
                imgOverlay.addEventListener('click', () => {
                    document.body.removeChild(imgOverlay);
                });
                document.body.appendChild(imgOverlay);
            }

            if (navigator.share) {
                fetch(filePath)
                    .then(res => res.blob())
                    .then(blob => {
                        const file = new File([blob], fileName, { type: blob.type });
                        if (navigator.canShare && navigator.canShare({ files: [file] })) {
                            navigator.share({
                                files: [file],
                                title: 'Gallery Image'
                            }).catch(e => console.log('Share canceled', e));
                        } else {
                            fallbackDownload(filePath, fileName);
                        }
                    }).catch(e => fallbackDownload(filePath, fileName));
            } else {
                fallbackDownload(filePath, fileName);
            }
        } catch (e) {
            console.error("Save Failed:", e);
            alert("この環境では画像の直接保存が制限されています。代わりにスクリーンショットをご使用ください。");
        }
    });

    document.getElementById('gallery-back').addEventListener('click', () => {
        isGalleryActive = false;
        document.getElementById('gallery-ui').style.display = 'none';
        document.getElementById('gallery-back').style.display = 'none';
        document.getElementById('game-ui').style.display = 'flex';
        showScreen('stageSelect');
    });

    // 情報ボタン（吹き出しツールチップ）
    const infoBtn = document.getElementById('extra-info-btn');
    const tooltip = document.getElementById('info-tooltip');
    if (infoBtn && tooltip) {
        const tooltipText = tooltip.querySelector('.bubble-text');
        const infoMessages = {
            'normal': 'ステージをクリアして、各種ステータスを強化しましょう！全てのステージを開放するとEXTRAモードが解禁されます。',
            'extra': 'EXTRAモードではブロックが減るほど、ボールの速度がNORMALモードと比べてわずかに大きくなります。また、一部ステータスの強化が一時無効化されます。',
            'gallery': 'クリアしたステージに応じて、ギャラリーが開放されます。全ての画像を開放するには、対応するステージをEXTRAモードでクリアする必要があります。'
        };

        const showTooltip = () => {
            tooltipText.textContent = infoMessages[gameMode] || '';
            tooltip.classList.add('active');
            const rect = infoBtn.getBoundingClientRect();
            // ツールチップが画面外にはみ出さないよう調整
            let tipX = rect.left + rect.width / 2 - 110;
            if (tipX + 240 > window.innerWidth) tipX = window.innerWidth - 250;
            if (tipX < 10) tipX = 10;
            tooltip.style.left = tipX + 'px';
            tooltip.style.top = (rect.top - 80) + 'px';
        };
        const hideTooltip = () => tooltip.classList.remove('active');

        infoBtn.addEventListener('mouseenter', showTooltip);
        infoBtn.addEventListener('mouseleave', hideTooltip);
        infoBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            if (tooltip.classList.contains('active')) hideTooltip();
            else showTooltip();
        });
        document.addEventListener('click', hideTooltip);
    }
    document.getElementById('close-extra-info').addEventListener('click', () => {
        document.getElementById('extra-info-modal').classList.remove('active');
    });

    // 設定画面の初期化とイベントバインド
    function initSettingsUI() {
        const bgmSelect = document.getElementById('bgm-volume-select');
        const seSelect = document.getElementById('se-volume-select');
        const bgmValText = document.getElementById('bgm-volume-value');
        const seValText = document.getElementById('se-volume-value');

        if (bgmSelect) {
            bgmSelect.value = BGM_VOLUME.toString();
            bgmValText.textContent = Math.round(BGM_VOLUME * 100).toString();
            bgmSelect.addEventListener('change', (e) => {
                BGM_VOLUME = parseFloat(e.target.value);
                bgmAudio.volume = BGM_VOLUME;
                bgmValText.textContent = Math.round(BGM_VOLUME * 100).toString();
                localStorage.setItem('breakout_bgm_vol', BGM_VOLUME.toString());
            });
        }

        if (seSelect) {
            seSelect.value = SE_VOLUME.toString();
            seValText.textContent = Math.round(SE_VOLUME * 100).toString();
            seSelect.addEventListener('change', (e) => {
                SE_VOLUME = parseFloat(e.target.value);
                seValText.textContent = Math.round(SE_VOLUME * 100).toString();
                localStorage.setItem('breakout_se_vol', SE_VOLUME.toString());
            });
        }

        const colorBlindToggle = document.getElementById('color-blind-toggle');
        const colorBlindLabel = document.getElementById('color-blind-label');
        if (colorBlindToggle && colorBlindLabel) {
            colorBlindToggle.checked = COLOR_BLIND_MODE;
            colorBlindLabel.textContent = COLOR_BLIND_MODE ? 'オン' : 'オフ';
            colorBlindToggle.addEventListener('change', (e) => {
                COLOR_BLIND_MODE = e.target.checked;
                colorBlindLabel.textContent = COLOR_BLIND_MODE ? 'オン' : 'オフ';
                localStorage.setItem('breakout_color_blind', COLOR_BLIND_MODE.toString());
            });
        }
    }
    initSettingsUI();

    // 画面遷移イベント
    document.getElementById('settings-btn').addEventListener('click', () => {
        showScreen('settings');
    });

    document.getElementById('back-to-title-from-settings').addEventListener('click', () => {
        showScreen('title');
    });
});
