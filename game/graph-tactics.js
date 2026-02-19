

window.GraphGame = {
    isPlaying: false, 
    turn: 1, 
    maxTurn: 30, 
    target: 100, // ゴールとなる面積スコア
    
    // プレイヤーデータ
    p1: { pos:{x:0,y:0,z:0}, history:[{x:0,y:0,z:0}], score:0, color:0x00f2ff, counts:{r:0,s:0,p:0} },
    p2: { pos:{x:0,y:0,z:0}, history:[{x:0,y:0,z:0}], score:0, color:0xff0055, counts:{r:0,s:0,p:0} },
    
    // Three.js 関連
    scene: null, camera: null, renderer: null, controls: null, pathGroup: null, animationId: null,
    
    // ゲーム進行管理
    mode: null,
    role: 'p1',
    timerId: null,
    timeLeft: 10,
    p1Hand: null, // ローカル対戦用の一時保存
    myHand: null, // オンライン用
    oppHand: null, // オンライン用

    init(mode) {
        this.mode = mode;
        this.role = mode === 'online-guest' ? 'p2' : 'p1';
        
        Shared.UI.show('screen-game');
        
        // ターン表示エリアの表示
        const turnArea = document.getElementById('turn-display-area');
        if(turnArea) turnArea.style.display = 'block';
        
        // タッチUIの初期化
        document.querySelectorAll('.touch-group').forEach(e => {
            e.classList.remove('active');
            e.style.display = ''; 
        });

        // じゃんけんUIの表示
        const rpsUI = document.getElementById('ui-rps');
        if(rpsUI) {
            rpsUI.classList.add('active');
            rpsUI.style.display = 'flex';
        }

        // ボタンイベントのバインド
        const bindBtn = (id, hand) => {
            const el = document.getElementById(id);
            if(el) {
                el.onclick = null; // 重複防止
                el.onclick = () => {
                    // タップ時のアニメーション
                    el.classList.add('active');
                    setTimeout(() => el.classList.remove('active'), 200);
                    this.play(hand);
                };
            }
        };
        bindBtn('r', 'r'); bindBtn('s', 's'); bindBtn('p', 'p');

        // オンラインイベント設定
        if (mode.includes('online')) {
            Shared.Net.onData = (d) => this.onNet(d);
        }

        // Three.jsとゲームの初期化
        setTimeout(() => {
            this.setupThree();
            this.reset();
            this.isPlaying = true;
            this.animate();
            this.startTimer(); // タイマースタート
        }, 100);
    },

    reset() {
        this.p1 = { pos:{x:0,y:0,z:0}, history:[{x:0,y:0,z:0}], score:0, color:0x00f2ff, counts:{r:0,s:0,p:0} };
        this.p2 = { pos:{x:0,y:0,z:0}, history:[{x:0,y:0,z:0}], score:0, color:0xff0055, counts:{r:0,s:0,p:0} };
        this.turn = 1;
        this.p1Hand = null;
        this.myHand = null;
        this.oppHand = null;
        
        this.updateHUD();
        this.drawGeometry();
        this.updateTurnUI('p1'); // 初期ターン表示
        
        const turnEl = document.getElementById('cur-turn');
        if(turnEl) turnEl.innerText = "1";
    },

    setupThree() {
        const cont = document.getElementById('game-container');
        const oldCvs = document.getElementById('main-cvs');
        if (oldCvs) oldCvs.remove();

        const cvs = document.createElement('canvas');
        cvs.id = 'main-cvs';
        cvs.style.width = '100%'; cvs.style.height = '100%';
        cvs.style.display = 'block'; cvs.style.position = 'absolute';
        cvs.style.top = '0'; cvs.style.left = '0'; cvs.style.zIndex = '1'; 
        cont.prepend(cvs);

        const width = cont.clientWidth;
        const height = cont.clientHeight;

        this.scene = new THREE.Scene();
        this.scene.background = new THREE.Color(0x05050a);

        this.camera = new THREE.PerspectiveCamera(60, width / height, 0.1, 1000);
        this.camera.position.set(40, 40, 40);
        this.camera.lookAt(0, 0, 0);

        this.renderer = new THREE.WebGLRenderer({ canvas: cvs, antialias: true, logarithmicDepthBuffer: true });
        this.renderer.setSize(width, height);
        this.renderer.setPixelRatio(window.devicePixelRatio);
        
        this.controls = new THREE.OrbitControls(this.camera, this.renderer.domElement);
        this.controls.enableDamping = true;
        this.controls.dampingFactor = 0.05;

        // ライト
        this.scene.add(new THREE.AmbientLight(0xffffff, 0.8));
        const dl = new THREE.DirectionalLight(0xffffff, 0.5);
        dl.position.set(10, 20, 10);
        this.scene.add(dl);

        // ガイド表示
        const grid = new THREE.GridHelper(100, 20, 0x444444, 0x111111);
        this.scene.add(grid);
        
        // 軸ヘルパー
        const axes = new THREE.AxesHelper(60);
        axes.position.y = 0.1;
        this.scene.add(axes);

        // ゴール目安の円盤 (半径20くらいのエリアを薄く表示)
        const goalGeo = new THREE.RingGeometry(19.5, 20, 32);
        const goalMat = new THREE.MeshBasicMaterial({ color: 0xffff00, side: THREE.DoubleSide, transparent: true, opacity: 0.3 });
        const goalRing = new THREE.Mesh(goalGeo, goalMat);
        goalRing.rotation.x = -Math.PI / 2;
        this.scene.add(goalRing);

        this.pathGroup = new THREE.Group();
        this.scene.add(this.pathGroup);
    },

    // --- タイマー処理 ---
    startTimer() {
        if(!this.isPlaying) return;
        clearInterval(this.timerId);
        
        const timerEl = document.getElementById('game-timer');
        if (!timerEl) return;
        
        timerEl.style.display = 'block';
        this.timeLeft = 15; // 思考時間15秒
        timerEl.innerText = this.timeLeft;
        timerEl.classList.remove('timer-danger');

        this.timerId = setInterval(() => {
            if(!this.isPlaying) { clearInterval(this.timerId); return; }
            
            this.timeLeft--;
            timerEl.innerText = this.timeLeft;
            
            if (this.timeLeft <= 5) timerEl.classList.add('timer-danger');
            
            if (this.timeLeft <= 0) {
                clearInterval(this.timerId);
                this.autoPlay();
            }
        }, 1000);
    },

    autoPlay() {
        // 時間切れ時の自動選択（オンラインの場合は何もしないか、ランダム送信などが考えられるがここではランダム）
        if(this.mode.includes('online') && this.myHand) return; // 既に選択済みなら何もしない

        const hands = ['r', 's', 'p'];
        const randomHand = hands[Math.floor(Math.random() * 3)];
        Shared.UI.msg("TIME OVER (AUTO)", "#aaa");
        this.play(randomHand);
    },

    // --- 入力処理 ---
    play(hand) {
        if (!this.isPlaying) return;
        Shared.Sound.preset('select');

        // オンライン対戦
        if (this.mode.includes('online')) {
            // 重複送信防止
            if(this.myHand) return;

            clearInterval(this.timerId); // 入力したらタイマー停止
            document.getElementById('game-timer').style.display = 'none';

            Shared.Net.send('hand', hand);
            this.myHand = hand;
            Shared.UI.msg("WAITING...", "#aaa");
            
            if (this.oppHand) this.resolve(this.myHand, this.oppHand);
        } 
        // ローカル対戦（1台で交互に操作）
        else if (this.mode === 'local') {
            if (!this.p1Hand) {
                // P1の入力
                this.p1Hand = hand;
                Shared.UI.msg("P2 SELECT!", "#ff0055");
                this.updateTurnUI('p2'); // P2のターンへ表示切替
                this.startTimer(); // タイマーリセット
            } else {
                // P2の入力 -> 解決
                const p1 = this.p1Hand;
                this.p1Hand = null;
                clearInterval(this.timerId);
                document.getElementById('game-timer').style.display = 'none';
                this.resolve(p1, hand);
            }
        } 
        // CPU対戦
        else {
            clearInterval(this.timerId);
            document.getElementById('game-timer').style.display = 'none';
            const cpu = ['r','s','p'][Math.floor(Math.random()*3)];
            this.resolve(hand, cpu);
        }
    },

    // --- 解決・結果処理 ---
    resolve(h1, h2) {
        const handIcons = { r: '✊', s: '✌️', p: '🖐' };
        const res = (h1===h2) ? 0 : ((h1==='r'&&h2==='s')||(h1==='s'&&h2==='p')||(h1==='p'&&h2==='r')) ? 1 : -1;
        
        // 結果表示メッセージ作成
        const battleMsg = `P1 ${handIcons[h1]} vs ${handIcons[h2]} P2`;
        let resultText = "";
        let color = "#fff";

        // P1の処理
        if (res === 1) {
            // P1勝ち
            const moveAmt = this.calcWinMove(this.p1, h1);
            this.move(this.p1, h1, moveAmt);
            this.splitHistory(this.p2); // 敗者(P2)は歪む
            resultText = `P1 WIN! (+${moveAmt})`;
            color = "#00f2ff";
            Shared.Sound.preset('win');
        } else if (res === -1) {
            // P1負け (P2勝ち)
            this.splitHistory(this.p1); // 敗者(P1)は歪む
        } else {
            // あいこ
            this.move(this.p1, h1, -1);
        }

        // P2の処理
        if (res === -1) {
            // P2勝ち
            const moveAmt = this.calcWinMove(this.p2, h2);
            this.move(this.p2, h2, moveAmt);
            resultText = `P2 WIN! (+${moveAmt})`;
            color = "#ff0055";
            Shared.Sound.preset('dead'); // P1視点でダメージ音
        } else if (res === 1) {
            // P2負け (既に処理済み)
        } else {
            // あいこ
            this.move(this.p2, h2, -1);
            resultText = "DRAW (-1)";
            Shared.Sound.preset('select');
        }

        Shared.UI.msg(`${battleMsg}\n${resultText}`, color);

        this.drawGeometry();
        this.updateHUD();

        // 終了判定または次ターンへ
        if (this.p1.score >= this.target || this.p2.score >= this.target || this.turn >= this.maxTurn) {
            setTimeout(() => this.end(), 1500);
        } else {
            // 少し待ってから次のターンを開始
            setTimeout(() => {
                if(!this.isPlaying) return;
                this.turn++;
                const turnEl = document.getElementById('cur-turn');
                if(turnEl) turnEl.innerText = this.turn;
                
                this.myHand = null; 
                this.oppHand = null;
                this.p1Hand = null;
                
                this.updateTurnUI('p1'); // ターン開始時はP1表示に戻す
                this.startTimer();
            }, 1500);
        }
    },

    // 勝利時の移動量計算 (指示通り：現在地 + 1 の加速仕様)
    calcWinMove(p, hand) {
        let currentVal = 0;
        if (hand === 'r') currentVal = p.pos.x; // r=x
        if (hand === 's') currentVal = p.pos.y; // s=y
        if (hand === 'p') currentVal = p.pos.z; // p=z
        
        // どんなにマイナスにいても、最低+1は進む。プラスにいるほど加速する。
        // Math.max(0, currentVal) にすることで、マイナス地点からの逆転は少し大変だが、プラス域に入ると一気に伸びる。
        return 1 + Math.floor(Math.max(0, currentVal));
    },

    // 座標更新
    move(p, hand, amount) {
        if (hand === 'r') p.pos.x += amount;
        if (hand === 's') p.pos.y += amount;
        if (hand === 'p') p.pos.z += amount;
        
        p.history.push({ ...p.pos });
        p.counts[hand]++;
    },

    // 敗北時の頂点分裂 (過去の軌跡を歪ませる)
    splitHistory(p) {
        if (p.history.length < 2) return;
        
        // ランダムな区間を選択
        const idx = Math.floor(Math.random() * (p.history.length - 1));
        const A = p.history[idx];
        const B = p.history[idx + 1];

        // 中間地点を作成
        const mid = {
            x: (A.x + B.x) / 2,
            y: (A.y + B.y) / 2,
            z: (A.z + B.z) / 2
        };

        // 少しノイズを乗せて歪ませる（これにより面積計算が狂い、戦略が崩れるペナルティ）
        mid.x += (Math.random() - 0.5) * 5;
        mid.y += (Math.random() - 0.5) * 5;
        mid.z += (Math.random() - 0.5) * 5;

        // 履歴に挿入
        p.history.splice(idx + 1, 0, mid);
    },

    drawGeometry() {
        if (!this.pathGroup) return;

        // 既存のオブジェクトをクリア
        while(this.pathGroup.children.length > 0) {
            const obj = this.pathGroup.children[0];
            this.pathGroup.remove(obj);
            if (obj.geometry) obj.geometry.dispose();
            if (obj.material) obj.material.dispose();
        }

        [this.p1, this.p2].forEach(p => {
            if (p.history.length < 2) return;
            const points = p.history.map(pt => new THREE.Vector3(pt.x, pt.y, pt.z));
            
            // 線 (Line)
            const lineGeo = new THREE.BufferGeometry().setFromPoints(points);
            const lineMat = new THREE.LineBasicMaterial({ color: p.color, linewidth: 3 });
            this.pathGroup.add(new THREE.Line(lineGeo, lineMat));
            
            // 面 (Shape) 原点と軌跡を結ぶポリゴン
            const vertices = [];
            const origin = new THREE.Vector3(0, 0, 0);
            for (let i = 1; i < points.length; i++) {
                // 原点、点A、点B で三角形を作る
                vertices.push(origin.x, origin.y, origin.z);
                vertices.push(points[i-1].x, points[i-1].y, points[i-1].z);
                vertices.push(points[i].x, points[i].y, points[i].z);
            }
            const shapeGeo = new THREE.BufferGeometry();
            shapeGeo.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
            
            // 半透明で描画して重なりを表現
            const shapeMat = new THREE.MeshBasicMaterial({ 
                color: p.color, 
                side: THREE.DoubleSide, 
                transparent: true, 
                opacity: 0.2,
                depthWrite: false // 透明描画順序対策
            });
            this.pathGroup.add(new THREE.Mesh(shapeGeo, shapeMat));

            // 現在地の球体
            const head = new THREE.Mesh(new THREE.SphereGeometry(1.5, 8, 8), new THREE.MeshBasicMaterial({ color: p.color }));
            head.position.copy(p.pos);
            this.pathGroup.add(head);
        });
        
        this.calcScore();
    },

    calcScore() {
        const calc = (p) => {
            let s = 0;
            // 面積計算 (外積の大きさの合計の簡易版)
            for(let i=1; i<p.history.length; i++) {
                const a = p.history[i-1];
                const b = p.history[i];
                // 三角形の面積 = |a x b| / 2 だが、スコアとしては2倍の値(平行四辺形面積)をそのまま使うなど調整
                // ここでは簡易的に各成分の外積の絶対値和を10で割ってスコアとする
                s += Math.abs(a.x*b.y - b.x*a.y) + Math.abs(a.y*b.z - b.y*a.z) + Math.abs(a.z*b.x - b.z*a.x);
            }
            return (s / 10).toFixed(0);
        };
        this.p1.score = calc(this.p1);
        this.p2.score = calc(this.p2);
    },

updateHUD() {
    // 左右にAREA、中央にGOALを配置
    const h1 = document.getElementById('hud-p1');
    const h2 = document.getElementById('hud-p2');
    const hc = document.getElementById('hud-center');
    
    if(h1) h1.innerText = `P1 AREA: ${this.p1.score}`;
    if(h2) h2.innerText = `P2 AREA: ${this.p2.score}`;
    if(hc) hc.innerText = `GOAL: ${this.target}`;
},

    // ターンプレイヤーのHUDを強調表示
    updateTurnUI(activePlayer) {
        const h1 = document.getElementById('hud-p1');
        const h2 = document.getElementById('hud-p2');
        if(!h1 || !h2) return;

        h1.style.border = "none";
        h2.style.border = "none";
        h1.style.background = "none";
        h2.style.background = "none";

        // 下線と背景色で強調
        if (activePlayer === 'p1') {
            h1.style.borderBottom = "4px solid var(--primary)";
            h1.style.background = "rgba(0, 242, 255, 0.1)";
        } else {
            h2.style.borderBottom = "4px solid var(--accent)";
            h2.style.background = "rgba(255, 0, 85, 0.1)";
        }
    },

    animate() {
        if (!this.isPlaying) return;
        // 安全装置: レンダラーが無ければループを止める
        if (!this.renderer) return;

        this.animationId = requestAnimationFrame(() => this.animate());
        if (this.controls) this.controls.update();
        if (this.renderer) this.renderer.render(this.scene, this.camera);
    },

    stop() {
        this.isPlaying = false;
        
        // タイマー停止
        if (this.timerId) {
            clearInterval(this.timerId);
            this.timerId = null;
        }
        
        // アニメーション停止
        if (this.animationId) {
            cancelAnimationFrame(this.animationId);
            this.animationId = null;
        }

        // Three.js 破棄
        if (this.renderer) {
            this.renderer.dispose();
            this.renderer.forceContextLoss();
            this.renderer = null;
        }
        this.scene = null;
        this.camera = null;
        
        // UI非表示
        const rpsUI = document.getElementById('ui-rps');
        if(rpsUI) rpsUI.style.display = 'none';
        const turnArea = document.getElementById('turn-display-area');
        if(turnArea) turnArea.style.display = 'none';
        const timerEl = document.getElementById('game-timer');
        if(timerEl) timerEl.style.display = 'none';
    },

    onNet(d) {
        if (d.type === 'hand') {
            this.oppHand = d.payload;
            // 自分が入力済みなら解決へ
            if (this.myHand) this.resolve(this.myHand, this.oppHand);
        }
    },

    end() {
        this.isPlaying = false;
        if(this.timerId) clearInterval(this.timerId);
        
        // UIクリーンアップ
        const turnArea = document.getElementById('turn-display-area');
        if(turnArea) turnArea.style.display = 'none';
        const rpsUI = document.getElementById('ui-rps');
        if(rpsUI) rpsUI.style.display = 'none';
        
        Shared.UI.show('screen-result');
        const s1 = Number(this.p1.score);
        const s2 = Number(this.p2.score);
        const res = (s1 > s2) ? "P1 WIN!" : (s2 > s1) ? "P2 WIN!" : "DRAW";
        document.getElementById('res-title').innerText = res;
        document.getElementById('res-detail').innerText = `SCORE: ${s1} vs ${s2}`;
    }
};