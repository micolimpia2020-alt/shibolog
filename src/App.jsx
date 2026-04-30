import { useState, useMemo, useRef, useCallback, useEffect } from "react";
import {
  LineChart, Line, BarChart, Bar,
  XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, ReferenceLine
} from "recharts";

// ─── カラー（モノトーン × ベージュ × チャコール）────
const C = {
  bg:     "#1a1a1a",
  bg2:    "#242424",
  card:   "rgba(255,255,255,0.04)",
  border: "rgba(255,255,255,0.08)",
  // メインアクセント
  orange: "#d4b896",   // ウォームベージュ
  yellow: "#c8b89a",   // ライトベージュ
  teal:   "#9aaa9a",   // セージグリーン
  purple: "#b0a898",   // ウォームグレージュ
  blue:   "#8a9aaa",   // スレートブルーグレー
  pink:   "#c4a090",   // ダスティローズ
  green:  "#8aaa8a",   // モスグリーン
  red:    "#c08080",   // マットローズレッド
  // テキスト
  text:   "#e8e4e0",
  muted:  "#7a7570",
  dim:    "#2e2b28",
  // 特殊
  gold:   "#c9a84c",
  white:  "#f0ede8",
  silver: "#9a9590",
};

// ─── ユーティリティ ───────────────────────────────────
const fmt1 = v => (v==null||isNaN(v) ? "—" : Number(v).toFixed(1));
const fmt0 = v => (v==null||isNaN(v) ? "—" : Math.round(v));

function calcProfile({height,weight,fatPct,maintenance}) {
  const h=parseFloat(height), w=parseFloat(weight),
        f=parseFloat(fatPct),  m=parseFloat(maintenance);
  if(!h||!w) return {};
  const bmi   = w/((h/100)**2);
  const lbm   = !isNaN(f) ? w*(1-f/100) : null;
  const fatKg = !isNaN(f) ? w*(f/100)   : null;
  const tdee  = (!isNaN(m)&&m>0) ? m : (10*w+6.25*h-5*30+5)*1.55;
  const cut=Math.round(tdee-500), maintain=Math.round(tdee), bulk=Math.round(tdee+300);
  const protein = lbm ? Math.round(lbm*2.2) : Math.round(w*2);
  const fat     = Math.round((cut*0.25)/9);
  const carb    = Math.round((cut-protein*4-fat*9)/4);
  const goalWeight = lbm ? Math.round(lbm/0.85*10)/10 : null;
  return {bmi,lbm,fatKg,tdee,cut,maintain,bulk,protein,fat,carb,goalWeight};
}

// ─── サンプルデータ生成 ───────────────────────────────
function makeWeek(label,m,start,wts,cals) {
  return {
    weekLabel:label, reflection:"", trainerComment:"",
    days: Array.from({length:7},(_,i)=>({
      date:`${m}/${start+i}`,
      morning: wts[i]?.[0], night: wts[i]?.[1],
      cal: cals[i], meals:[], mood:"",
      training:{ done:i%3!==0, parts:i%3!==0?["胸","背中","脚"][i%3]:"", cardio:0, cardioKcal:0 },
      note:"",
    })),
  };
}

const INIT_WEEKS = [
  makeWeek("3/11〜3/17",3,11,
    [[49.3,49.8],[49.1,49.1],[48.7,49.1],[49.2,49.2],[49.0,49.0],[48.8,48.8],[48.5,48.8]],
    [1000,1000,1000,940,1000,930,920]),
  makeWeek("3/18〜3/24",3,18,
    [[48.5,48.8],[48.5,48.8],[48.5,48.8],[48.4,48.8],[48.4,48.9],[48.5,null],[48.3,48.7]],
    [920,1000,1020,900,950,980,910]),
];

// ─── スタイルヘルパー ─────────────────────────────────
const cardSt = (ex={}) => ({
  background:"#222220",
  borderRadius:14,
  border:"1px solid rgba(255,255,255,0.07)",
  padding:18,
  ...ex
});
const inpSt = (accent="rgba(255,255,255,0.1)") => ({
  width:"100%", boxSizing:"border-box", padding:"11px 14px",
  background:"#2a2826",
  border:`1px solid ${accent}`,
  borderRadius:10, color:C.text, fontSize:14, outline:"none",
});
const btnGrad = (a,b,ex={}) => ({
  border:"none", borderRadius:10, cursor:"pointer",
  fontWeight:700, color:C.white,
  background:`linear-gradient(135deg,${a},${b})`, ...ex
});

const TABS  = ["ダッシュボード","食事","トレーニング","記録","カレンダー","設定"];
const TICON = ["📊","🍽️","💪","📋","📅","⚙️"];

// ─── 励ましメッセージ ─────────────────────────────────
const PRAISE = {
  morning: ["🌅 朝の記録お疲れ様！その積み重ねが結果につながるよ✨","☀️ 朝から記録できてる、すごい！継続は力なり💪","🌸 今日もスタートダッシュ！最高の一日にしよう🔥","🏆 朝体重チェック完了！自分の体と向き合えてるね✨"],
  night:   ["🌙 今日も一日お疲れ様でした✨ 記録できた自分を褒めよう！","⭐ 夜まで記録続けてる、本当に頑張ってる！明日も一緒に頑張ろう💫","🌟 今日もお疲れ様✨ 継続できてることが一番の成果だよ！","💤 ゆっくり休んでね。また明日も一緒に頑張ろう🌙"],
  meal:    ["🍽️ 食事記録バッチリ！意識して食べることが大事✨","✅ 記録してえらい！食べたものを把握できてるね💪","🥗 食事管理できてる！この調子で続けよう🔥","👏 ちゃんと記録してる、素晴らしい！小さな積み重ねが結果につながるよ✨"],
  training:["💪 トレーニング記録した！動いた日は必ず体が変わってる✨","🔥 筋トレ記録完了！その努力、絶対に裏切らないよ💫","🏋️ 今日も動いた！継続してる自分を誇りに思って✨","⚡ トレーニング完了！また一歩、目標に近づいたね🎯"],
};
const getRandom = arr => arr[Math.floor(Math.random()*arr.length)];


// ─── メインコンポーネント ─────────────────────────────
export default function DietTracker() {
  const [tab, setTab]       = useState("ダッシュボード");
  const [profile, setProfile] = useState(() => {
    try { const s = localStorage.getItem("shibolog_profile"); return s ? JSON.parse(s) : { height:"", weight:"", fatPct:"", maintenance:"" }; } catch { return { height:"", weight:"", fatPct:"", maintenance:"" }; }
  });
  const [weeks, setWeeks] = useState(() => {
    try { const s = localStorage.getItem("shibolog_weeks"); return s ? JSON.parse(s) : INIT_WEEKS; } catch { return INIT_WEEKS; }
  });

  // 自動保存
  useEffect(() => { try { localStorage.setItem("shibolog_profile", JSON.stringify(profile)); } catch {} }, [profile]);
  useEffect(() => { try { localStorage.setItem("shibolog_weeks", JSON.stringify(weeks)); } catch {} }, [weeks]);
  const [selWeek, setSelWeek] = useState(0);
  const [selDay,  setSelDay]  = useState(0);

  // 食事フォーム
  const [mealForm, setMealForm] = useState({ time:"", name:"", kcal:"", protein:"", fat:"", carb:"", photo:null });
  // 共有
  const [shareURL, setShareURL]     = useState("");
  const [shareCopied, setShareCopied] = useState(false);
  // 褒めメッセージ
  const [praiseMsg, setPraiseMsg] = useState("");
  // 体型写真
  const [bodyPhoto, setBodyPhoto] = useState(null);
  const bodyPhotoRef = useRef();
  // 目標設定
  const [goal, setGoal] = useState(() => {
    try { const s = localStorage.getItem("shibolog_goal"); return s ? JSON.parse(s) : { type:"", targetNum:"", targetLook:"", targetDate:"", refPhoto:null }; } catch { return { type:"", targetNum:"", targetLook:"", targetDate:"", refPhoto:null }; }
  });

  useEffect(() => { try { localStorage.setItem("shibolog_goal", JSON.stringify(goal)); } catch {} }, [goal]);
  const goalPhotoRef = useRef();
  // リマインド設定
  const [remindMorning, setRemindMorning] = useState("07:00");
  const [remindNight,   setRemindNight]   = useState("21:00");
  const [remindEnabled, setRemindEnabled] = useState(false);
  const [remindStatus,  setRemindStatus]  = useState("");

  const photoRef = useRef();
  const calc = useMemo(()=>calcProfile(profile),[profile]);

  // ─ 体型写真ハンドラ
  function handleBodyPhoto(e) {
    const file = e.target.files?.[0]; if(!file) return;
    const reader = new FileReader();
    reader.onload = ev => setBodyPhoto(ev.target.result);
    reader.readAsDataURL(file);
  }

  // ─ 褒めメッセージ表示
  function showPraise(type) {
    setPraiseMsg(getRandom(PRAISE[type]));
    setTimeout(()=>setPraiseMsg(""), 4000);
  }

  // ─ リマインド設定
  async function setupReminders() {
    if(!("Notification" in window)) {
      setRemindStatus("このブラウザは通知に対応していません");
      return;
    }
    const perm = await Notification.requestPermission();
    if(perm !== "granted") {
      setRemindStatus("通知が許可されませんでした。ブラウザの設定から許可してください。");
      return;
    }
    setRemindEnabled(true);
    setRemindStatus("✅ リマインドを設定しました！");

    // 朝リマインド
    scheduleNotification(remindMorning, "📝 記録の時間です！",
      "今日の記録は済みましたか？日々の記録が目標達成の近道です✨");
    // 夜リマインド
    scheduleNotification(remindNight, "🌙 お疲れ様でした！",
      "今日もお疲れ様でした✨ 夜の記録を忘れずに。明日も頑張りましょう！");
  }

  function scheduleNotification(timeStr, title, body) {
    const [h, m] = timeStr.split(":").map(Number);
    const now = new Date();
    const target = new Date();
    target.setHours(h, m, 0, 0);
    if(target <= now) target.setDate(target.getDate()+1);
    const delay = target.getTime() - now.getTime();
    setTimeout(()=>{
      new Notification(title, { body, icon:"🔥" });
    }, delay);
  }

  const currentWeek = weeks[selWeek];
  const currentDay  = currentWeek?.days[selDay];

  // 週平均
  const weekStats = useMemo(()=>weeks.map(w=>{
    const ms=w.days.map(d=>d.morning).filter(v=>v!=null);
    const ns=w.days.map(d=>d.night).filter(v=>v!=null);
    const cs=w.days.map(d=>d.cal).filter(v=>v!=null);
    return {
      label: w.weekLabel,
      avgMorning: ms.length?(ms.reduce((a,b)=>a+b,0)/ms.length).toFixed(1):"—",
      avgNight:   ns.length?(ns.reduce((a,b)=>a+b,0)/ns.length).toFixed(1):"—",
      avgCal:     cs.length?Math.round(cs.reduce((a,b)=>a+b,0)/cs.length):"—",
    };
  }),[weeks]);

  const chartData = useMemo(()=>weeks.flatMap(w=>w.days).map(d=>({
    date:d.date, 朝体重:d.morning, 夜体重:d.night, カロリー:d.cal
  })),[weeks]);

  // 食事合計
  const mealTotals = useMemo(()=>{
    const ms = currentDay?.meals||[];
    return {
      kcal:    ms.reduce((s,m)=>s+(parseFloat(m.kcal)||0),0),
      protein: ms.reduce((s,m)=>s+(parseFloat(m.protein)||0),0),
      fat:     ms.reduce((s,m)=>s+(parseFloat(m.fat)||0),0),
      carb:    ms.reduce((s,m)=>s+(parseFloat(m.carb)||0),0),
    };
  },[currentDay]);

  // ─ ヘルパー
  const updateDay  = useCallback((wi,di,patch)=>
    setWeeks(ws=>ws.map((w,i)=>i!==wi?w:{...w,days:w.days.map((d,j)=>j!==di?d:{...d,...patch})})),[]);
  const updateWeek = useCallback((wi,patch)=>
    setWeeks(ws=>ws.map((w,i)=>i!==wi?w:{...w,...patch})),[]);

  function addMeal() {
    if(!mealForm.time||!mealForm.name) return;
    const meal = {...mealForm, id:Date.now()};
    const meals = [...(currentDay.meals||[]), meal];
    const totalCal = meals.reduce((s,m)=>s+(parseFloat(m.kcal)||0),0);
    updateDay(selWeek,selDay,{meals, cal:Math.round(totalCal)});
    setMealForm({time:"",name:"",kcal:"",protein:"",fat:"",carb:"",photo:null});
    showPraise("meal");
  }
  function removeMeal(id) {
    const meals = (currentDay.meals||[]).filter(m=>m.id!==id);
    updateDay(selWeek,selDay,{meals, cal:Math.round(meals.reduce((s,m)=>s+(parseFloat(m.kcal)||0),0))});
  }
  function handlePhoto(e) {
    const file = e.target.files?.[0]; if(!file) return;
    const reader = new FileReader();
    reader.onload = ev => setMealForm(f=>({...f,photo:ev.target.result}));
    reader.readAsDataURL(file);
  }

  // ─ 共有URL生成
  function generateShareURL() {
    const summary = {
      profile,
      weekStats,
      weeks: weeks.map(w=>({
        weekLabel: w.weekLabel,
        reflection: w.reflection,
        trainerComment: w.trainerComment,
        days: w.days.map(d=>({
          date:d.date, morning:d.morning, night:d.night, cal:d.cal,
          training:d.training, note:d.note,
          meals: d.meals.map(m=>({time:m.time,name:m.name,kcal:m.kcal,protein:m.protein,fat:m.fat,carb:m.carb}))
        }))
      }))
    };
    const encoded = btoa(unescape(encodeURIComponent(JSON.stringify(summary))));
    const url = `${window.location.origin}${window.location.pathname}?share=${encoded}`;
    setShareURL(url);
  }
  function copyURL() {
    if(!shareURL) return;
    navigator.clipboard.writeText(shareURL).then(()=>{
      setShareCopied(true);
      setTimeout(()=>setShareCopied(false),2500);
    });
  }

  // ─── UI ────────────────────────────────────────────
  return (
    <div style={{minHeight:"100vh",background:"#1a1a1a",fontFamily:"'Hiragino Sans','Yu Gothic',sans-serif",color:C.text,paddingBottom:76}}>
      <style>{`
        @keyframes pulse{0%,100%{opacity:1}50%{opacity:.6}}
        @keyframes fadeIn{from{opacity:0;transform:translateY(-4px)}to{opacity:1;transform:translateY(0)}}
        * { -webkit-tap-highlight-color: transparent; }
      `}</style>

      {/* ヘッダー */}
      <div style={{background:"#111111",borderBottom:"1px solid rgba(255,255,255,0.07)",padding:"16px 20px",display:"flex",alignItems:"center",gap:12}}>
        <div style={{width:38,height:38,borderRadius:10,background:"linear-gradient(135deg,#2e2b28,#3d3a36)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:18,border:"1px solid rgba(255,255,255,0.1)"}}>🔥</div>
        <div>
          <div style={{fontSize:18,fontWeight:800,letterSpacing:"0.08em",color:C.white}}>しぼログ</div>
          <div style={{fontSize:10,color:C.muted,letterSpacing:"0.04em"}}>シャイニー薊監修 筋トレ・ダイエット記録</div>
        </div>
      </div>

      {/* タブバー（固定） */}
      <div style={{position:"fixed",bottom:0,left:0,right:0,background:"#111111",borderTop:"1px solid rgba(255,255,255,0.07)",display:"flex",zIndex:100}}>
        {TABS.map((t,i)=>(
          <button key={t} onClick={()=>setTab(t)} style={{flex:1,padding:"10px 2px 8px",border:"none",background:"transparent",cursor:"pointer",display:"flex",flexDirection:"column",alignItems:"center",gap:2,
            color:tab===t?C.orange:C.muted,
            borderTop:tab===t?`2px solid ${C.orange}`:"2px solid transparent"}}>
            <span style={{fontSize:16}}>{TICON[i]}</span>
            <span style={{fontSize:9,fontWeight:700,letterSpacing:"0.02em"}}>{t}</span>
          </button>
        ))}
      </div>

      <div style={{padding:"16px 16px 0"}}>

        {/* ══════════════ ダッシュボード ══════════════ */}
        {tab==="ダッシュボード" && (
          <div style={{display:"flex",flexDirection:"column",gap:14}}>

            {/* 週セレクタ */}
            <div style={{display:"flex",gap:8,overflowX:"auto",paddingBottom:4}}>
              {weeks.map((w,i)=>(
                <button key={i} onClick={()=>{setSelWeek(i);setSelDay(0);}} style={{padding:"6px 14px",borderRadius:999,border:"none",cursor:"pointer",whiteSpace:"nowrap",fontSize:12,fontWeight:700,background:selWeek===i?`linear-gradient(135deg,${C.orange},${C.pink})`:"rgba(255,255,255,0.07)",color:selWeek===i?"#fff":C.muted}}>{w.weekLabel}</button>
              ))}
            </div>

            {/* 目標バナー（入力済みのときだけ表示） */}
            {(goal.type || goal.targetNum || goal.targetDate) && (
              <div style={{
                display:"flex", alignItems:"center", gap:10,
                padding:"10px 14px", borderRadius:12,
                background:`linear-gradient(135deg,rgba(255,107,157,0.12),rgba(180,138,255,0.1))`,
                border:`1px solid ${C.pink}44`,
              }}>
                <span style={{fontSize:18}}>🎯</span>
                <div style={{flex:1,fontSize:12,lineHeight:1.6}}>
                  {goal.type && <span style={{fontWeight:800,color:C.pink,marginRight:6}}>{goal.type}</span>}
                  {goal.targetNum && <span style={{color:C.text}}>{goal.targetNum}</span>}
                  {goal.targetDate && <span style={{color:C.muted,marginLeft:6}}>／ {goal.targetDate}</span>}
                </div>
                <button onClick={()=>setTab("設定")}
                  style={{fontSize:10,color:C.purple,background:"none",border:"none",cursor:"pointer",fontWeight:700,whiteSpace:"nowrap"}}>
                  編集 →
                </button>
              </div>
            )}

            {/* 週平均 */}
            <div style={cardSt()}>
              <div style={{fontSize:13,fontWeight:700,color:C.teal,marginBottom:12}}>📊 今週の平均値</div>
              <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:10}}>
                {[
                  {lbl:"朝体重",val:weekStats[selWeek]?.avgMorning,unit:"kg",color:C.yellow},
                  {lbl:"夜体重",val:weekStats[selWeek]?.avgNight,  unit:"kg",color:C.purple},
                  {lbl:"カロリー",val:weekStats[selWeek]?.avgCal,  unit:"kcal",color:C.orange},
                ].map(({lbl,val,unit,color})=>(
                  <div key={lbl} style={{background:"rgba(255,255,255,0.04)",borderRadius:12,padding:"12px 8px",textAlign:"center",border:`1px solid ${color}33`}}>
                    <div style={{fontSize:10,color:C.muted,marginBottom:4}}>{lbl}平均</div>
                    <div style={{fontSize:18,fontWeight:800,color}}>{val}</div>
                    <div style={{fontSize:10,color:C.dim}}>{unit}</div>
                  </div>
                ))}
              </div>
            </div>

            {/* 📅 カレンダー（タップでカレンダータブへ） */}
            <div style={cardSt({cursor:"pointer"})} onClick={()=>setTab("カレンダー")}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:14}}>
                <div style={{fontSize:13,fontWeight:700,color:C.purple}}>📅 週間カレンダー</div>
                <span style={{fontSize:11,color:C.muted}}>タップで月間表示 →</span>
              </div>
              <div style={{display:"grid",gridTemplateColumns:"repeat(7,1fr)",gap:4}}>
                {currentWeek?.days.map((d,i)=>{
                  const parts = (d.training?.parts||"").split(",").filter(Boolean);
                  const hasTrain = d.training?.done;
                  return (
                    <div key={i} style={{
                      background: hasTrain ? "rgba(255,107,53,0.12)" : "rgba(255,255,255,0.04)",
                      borderRadius:12,
                      border: hasTrain ? `1px solid ${C.orange}44` : `1px solid ${C.border}`,
                      padding:"8px 4px",
                      textAlign:"center",
                      minHeight:90,
                      display:"flex", flexDirection:"column", alignItems:"center", gap:3,
                    }}>
                      {/* 日付 */}
                      <div style={{fontSize:10,fontWeight:800,color: hasTrain ? C.orange : C.muted}}>
                        {d.date.split("/")[1]}
                      </div>
                      {/* 曜日 */}
                      <div style={{fontSize:9,color:C.dim}}>
                        {["月","火","水","木","金","土","日"][i]}
                      </div>
                      {/* 絵文字 */}
                      {d.mood && (
                        <div style={{fontSize:16,lineHeight:1}}>{d.mood}</div>
                      )}
                      {/* 部位タグ */}
                      {parts.slice(0,2).map((p,pi)=>(
                        <div key={pi} style={{
                          fontSize:8, fontWeight:700,
                          background:`${C.orange}22`, color:C.orange,
                          borderRadius:4, padding:"1px 4px",
                          maxWidth:"100%", overflow:"hidden",
                          textOverflow:"ellipsis", whiteSpace:"nowrap",
                        }}>{p}</div>
                      ))}
                      {parts.length > 2 && (
                        <div style={{fontSize:8,color:C.muted}}>+{parts.length-2}</div>
                      )}
                      {/* 休養日マーク */}
                      {!hasTrain && (
                        <div style={{fontSize:9,color:C.dim,marginTop:"auto"}}>休</div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>

            {/* 体重グラフ */}
            <div style={cardSt()}>
              <div style={{fontSize:13,fontWeight:700,color:C.yellow,marginBottom:10}}>⚖️ 体重推移</div>
              <ResponsiveContainer width="100%" height={200}>
                <LineChart data={chartData} margin={{left:-15,right:8}}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" />
                  <XAxis dataKey="date" tick={{fill:C.muted,fontSize:9}} interval={2}/>
                  <YAxis domain={["auto","auto"]} tick={{fill:C.muted,fontSize:9}}/>
                  <Tooltip contentStyle={{background:"#1a2535",border:"none",borderRadius:10,fontSize:12}}/>
                  {calc.goalWeight && <ReferenceLine y={calc.goalWeight} stroke={C.purple} strokeDasharray="4 4" label={{value:`目標 ${calc.goalWeight}kg`,fill:C.purple,fontSize:9,position:"insideTopRight"}}/>}
                  <Line type="monotone" dataKey="朝体重" stroke={C.yellow} strokeWidth={2} dot={{r:2,fill:C.yellow}} connectNulls/>
                  <Line type="monotone" dataKey="夜体重" stroke={C.purple} strokeWidth={2} dot={{r:2,fill:C.purple}} connectNulls/>
                </LineChart>
              </ResponsiveContainer>
              <div style={{display:"flex",gap:16,justifyContent:"center",marginTop:6}}>
                <span style={{fontSize:11,color:C.yellow}}>● 朝体重</span>
                <span style={{fontSize:11,color:C.purple}}>● 夜体重</span>
                {calc.goalWeight&&<span style={{fontSize:11,color:C.purple}}>-- 目標</span>}
              </div>
            </div>

            {/* カロリーグラフ */}
            <div style={cardSt()}>
              <div style={{fontSize:13,fontWeight:700,color:C.green,marginBottom:10}}>🍽️ カロリー推移</div>
              <ResponsiveContainer width="100%" height={180}>
                <BarChart data={chartData} margin={{left:-15,right:8}}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)"/>
                  <XAxis dataKey="date" tick={{fill:C.muted,fontSize:9}} interval={2}/>
                  <YAxis tick={{fill:C.muted,fontSize:9}}/>
                  <Tooltip contentStyle={{background:"#1a2535",border:"none",borderRadius:10,fontSize:12}}/>
                  {calc.cut&&<ReferenceLine y={calc.cut} stroke={C.orange} strokeDasharray="4 4" label={{value:`目標 ${calc.cut}`,fill:C.orange,fontSize:9,position:"insideTopRight"}}/>}
                  <Bar dataKey="カロリー" fill={C.teal} radius={[4,4,0,0]}/>
                </BarChart>
              </ResponsiveContainer>
            </div>

            {/* 週別平均一覧 */}
            <div style={cardSt()}>
              <div style={{fontSize:13,fontWeight:700,color:C.blue,marginBottom:12}}>📅 週ごとの平均</div>
              {weekStats.map((ws,i)=>(
                <div key={i} style={{padding:"10px 0",borderBottom:`1px solid ${C.border}`,display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                  <div style={{fontSize:12,fontWeight:700,color:C.orange}}>{ws.label}</div>
                  <div style={{display:"flex",gap:10,fontSize:12}}>
                    <span style={{color:C.yellow}}>🌅{ws.avgMorning}kg</span>
                    <span style={{color:C.purple}}>🌙{ws.avgNight}kg</span>
                    <span style={{color:C.green}}>{ws.avgCal}kcal</span>
                  </div>
                </div>
              ))}
            </div>

          </div>
        )}

        {/* ══════════════ 食事 ══════════════ */}
        {tab==="食事" && (
          <div style={{display:"flex",flexDirection:"column",gap:14}}>

            {/* 褒めメッセージバナー */}
            {praiseMsg && (
              <div style={{
                padding:"14px 16px", borderRadius:14,
                background:`linear-gradient(135deg,rgba(255,107,53,0.18),rgba(180,138,255,0.18))`,
                border:`1px solid ${C.orange}55`,
                fontSize:14, fontWeight:700, lineHeight:1.6,
                animation:"fadeIn 0.3s ease",
              }}>
                {praiseMsg}
              </div>
            )}

            {/* 日選択 */}
            <div style={{display:"flex",gap:6,overflowX:"auto",paddingBottom:4}}>
              {currentWeek?.days.map((d,i)=>(
                <button key={i} onClick={()=>setSelDay(i)} style={{padding:"6px 12px",borderRadius:999,border:"none",cursor:"pointer",whiteSpace:"nowrap",fontSize:12,fontWeight:700,background:selDay===i?`linear-gradient(135deg,${C.teal},${C.blue})`:"rgba(255,255,255,0.07)",color:selDay===i?"#fff":C.muted}}>{d.date}</button>
              ))}
            </div>

            {/* 体重入力 */}
            <div style={cardSt()}>
              <div style={{fontSize:13,fontWeight:700,color:C.yellow,marginBottom:12}}>⚖️ {currentDay?.date} の体重</div>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
                <div>
                  <div style={{fontSize:11,color:C.yellow,marginBottom:5}}>🌅 朝の体重</div>
                  <input type="number" step="0.1" placeholder="例: 48.5" value={currentDay?.morning??""} style={inpSt(`${C.yellow}55`)}
                    onChange={e=>{updateDay(selWeek,selDay,{morning:e.target.value?parseFloat(e.target.value):undefined});if(e.target.value)showPraise("morning");}}/>
                </div>
                <div>
                  <div style={{fontSize:11,color:C.purple,marginBottom:5}}>🌙 夜の体重</div>
                  <input type="number" step="0.1" placeholder="例: 49.0" value={currentDay?.night??""} style={inpSt(`${C.purple}55`)}
                    onChange={e=>{updateDay(selWeek,selDay,{night:e.target.value?parseFloat(e.target.value):undefined});if(e.target.value)showPraise("night");}}/>
                </div>
              </div>
            </div>

            {/* 体型写真 */}
            <div style={cardSt({border:`1px solid ${C.pink}44`})}>
              <div style={{fontSize:13,fontWeight:700,color:C.pink,marginBottom:10}}>📸 今日の体型写真</div>
              <input type="file" accept="image/*" ref={bodyPhotoRef} style={{display:"none"}} onChange={handleBodyPhoto}/>
              {bodyPhoto
                ? (
                  <div>
                    <img src={bodyPhoto} alt="body" style={{width:"100%",borderRadius:12,maxHeight:300,objectFit:"cover",marginBottom:8}}/>
                    <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}}>
                      <button onClick={()=>{bodyPhotoRef.current.removeAttribute("capture");bodyPhotoRef.current.click();}}
                        style={{padding:"8px",border:`1px solid ${C.border}`,borderRadius:10,background:"rgba(255,255,255,0.04)",color:C.muted,fontSize:12,cursor:"pointer"}}>
                        🔄 写真を変更
                      </button>
                      <button onClick={()=>setBodyPhoto(null)}
                        style={{padding:"8px",border:`1px solid ${C.red}44`,borderRadius:10,background:"rgba(255,95,95,0.06)",color:C.red,fontSize:12,cursor:"pointer"}}>
                        🗑️ 削除
                      </button>
                    </div>
                  </div>
                ) : (
                  <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}}>
                    <button onClick={()=>{bodyPhotoRef.current.removeAttribute("capture");bodyPhotoRef.current.click();}}
                      style={{...btnGrad(C.pink,C.purple),padding:"11px",fontSize:12}}>
                      📁 フォルダから選択
                    </button>
                    <button onClick={()=>{bodyPhotoRef.current.setAttribute("capture","environment");bodyPhotoRef.current.click();}}
                      style={{...btnGrad(C.purple,C.blue),padding:"11px",fontSize:12}}>
                      📷 カメラで撮影
                    </button>
                  </div>
                )
              }
            </div>

            {/* Slismリンク */}
            <div style={cardSt({border:`1px solid ${C.teal}44`})}>
              <div style={{fontSize:13,fontWeight:700,color:C.teal,marginBottom:6}}>🔍 カロリーを調べる</div>
              <div style={{fontSize:12,color:C.muted,marginBottom:12}}>カロリーSlismで食材のカロリー・PFCを確認できます</div>
              <a href="https://calorie.slism.jp" target="_blank" rel="noopener noreferrer" style={{display:"block",textDecoration:"none"}}>
                <button style={{...btnGrad(C.teal,C.blue),width:"100%",padding:"12px",fontSize:14,pointerEvents:"none"}}>
                  🌐 カロリーSlismを開く
                </button>
              </a>
            </div>

            {/* 食事追加フォーム */}
            <div style={cardSt()}>
              <div style={{fontSize:13,fontWeight:700,color:C.orange,marginBottom:12}}>➕ 食事を追加</div>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,marginBottom:8}}>
                <div>
                  <div style={{fontSize:11,color:C.muted,marginBottom:4}}>時間</div>
                  <input type="time" value={mealForm.time} style={inpSt(`${C.orange}55`)} onChange={e=>setMealForm(f=>({...f,time:e.target.value}))}/>
                </div>
                <div>
                  <div style={{fontSize:11,color:C.muted,marginBottom:4}}>食事名</div>
                  <input type="text" placeholder="例: 鶏むね定食" value={mealForm.name} style={inpSt()} onChange={e=>setMealForm(f=>({...f,name:e.target.value}))}/>
                </div>
              </div>
              <div style={{display:"grid",gridTemplateColumns:"repeat(2,1fr)",gap:8,marginBottom:8}}>
                {[
                  {key:"kcal",lbl:"カロリー (kcal)",color:C.orange},
                  {key:"protein",lbl:"P タンパク質 (g)",color:C.green},
                  {key:"fat",lbl:"F 脂質 (g)",color:C.yellow},
                  {key:"carb",lbl:"C 炭水化物 (g)",color:C.blue},
                ].map(({key,lbl,color})=>(
                  <div key={key}>
                    <div style={{fontSize:11,color,marginBottom:4}}>{lbl}</div>
                    <input type="number" placeholder="0" value={mealForm[key]} style={inpSt(`${color}44`)} onChange={e=>setMealForm(f=>({...f,[key]:e.target.value}))}/>
                  </div>
                ))}
              </div>

              {/* 写真 */}
              <input type="file" accept="image/*" ref={photoRef} style={{display:"none"}} onChange={handlePhoto}/>
              <div style={{marginBottom:10}}>
                <div style={{fontSize:11,color:C.muted,marginBottom:6}}>📷 写真を追加</div>
                <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}}>
                  <button onClick={()=>{photoRef.current.removeAttribute("capture");photoRef.current.click();}}
                    style={{padding:"9px",border:`1px solid ${C.border}`,borderRadius:10,background:"rgba(255,255,255,0.04)",color:C.muted,fontSize:12,cursor:"pointer"}}>
                    📁 フォルダから選択
                  </button>
                  <button onClick={()=>{photoRef.current.setAttribute("capture","environment");photoRef.current.click();}}
                    style={{padding:"9px",border:`1px solid ${C.border}`,borderRadius:10,background:"rgba(255,255,255,0.04)",color:C.muted,fontSize:12,cursor:"pointer"}}>
                    📷 カメラで撮影
                  </button>
                </div>
                {mealForm.photo&&<img src={mealForm.photo} alt="food" style={{width:"100%",borderRadius:10,marginTop:8,maxHeight:180,objectFit:"cover"}}/>}
              </div>

              <button onClick={addMeal} style={{...btnGrad(C.orange,C.pink),width:"100%",padding:"12px",fontSize:14}}>
                ＋ この食事を記録する
              </button>
            </div>

            {/* 食事一覧 */}
            {(currentDay?.meals?.length>0)&&(
              <div style={cardSt()}>
                <div style={{fontSize:13,fontWeight:700,color:C.teal,marginBottom:12}}>🍽️ {currentDay.date} の食事記録</div>
                {/* 合計 */}
                <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:6,marginBottom:10}}>
                  {[
                    {lbl:"合計",val:Math.round(mealTotals.kcal),unit:"kcal",color:C.orange},
                    {lbl:"P",val:fmt1(mealTotals.protein),unit:"g",color:C.green},
                    {lbl:"F",val:fmt1(mealTotals.fat),unit:"g",color:C.yellow},
                    {lbl:"C",val:fmt1(mealTotals.carb),unit:"g",color:C.blue},
                  ].map(({lbl,val,unit,color})=>(
                    <div key={lbl} style={{textAlign:"center",background:"rgba(255,255,255,0.05)",borderRadius:10,padding:"8px 4px",border:`1px solid ${color}33`}}>
                      <div style={{fontSize:9,color:C.muted}}>{lbl}</div>
                      <div style={{fontSize:16,fontWeight:800,color}}>{val}</div>
                      <div style={{fontSize:9,color:C.muted}}>{unit}</div>
                    </div>
                  ))}
                </div>
                {calc.cut&&(
                  <div style={{fontSize:12,marginBottom:10,padding:"8px 12px",borderRadius:8,
                    background:mealTotals.kcal<=calc.cut?"rgba(74,222,128,0.1)":"rgba(255,95,95,0.1)",
                    color:mealTotals.kcal<=calc.cut?C.green:C.red}}>
                    {mealTotals.kcal<=calc.cut
                      ?`✅ 目標 ${calc.cut}kcal 以内！あと ${calc.cut-Math.round(mealTotals.kcal)}kcal`
                      :`⚠️ 目標より ${Math.round(mealTotals.kcal)-calc.cut}kcal オーバー`}
                  </div>
                )}
                {[...currentDay.meals].sort((a,b)=>a.time.localeCompare(b.time)).map(m=>(
                  <div key={m.id} style={{padding:"12px 0",borderBottom:`1px solid ${C.border}`}}>
                    <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start"}}>
                      <div>
                        <div style={{fontSize:13,fontWeight:700}}>{m.time} {m.name}</div>
                        <div style={{fontSize:11,color:C.muted,marginTop:3}}>
                          {m.kcal&&`${m.kcal}kcal`}{m.protein&&` P:${m.protein}g`}{m.fat&&` F:${m.fat}g`}{m.carb&&` C:${m.carb}g`}
                        </div>
                      </div>
                      <button onClick={()=>removeMeal(m.id)} style={{background:"rgba(255,95,95,0.15)",border:"none",borderRadius:6,padding:"4px 10px",color:C.red,fontSize:12,cursor:"pointer"}}>削除</button>
                    </div>
                    {m.photo&&<img src={m.photo} alt="" style={{width:"100%",borderRadius:8,marginTop:8,maxHeight:160,objectFit:"cover"}}/>}
                  </div>
                ))}
              </div>
            )}

            {/* 日メモ */}
            <div style={cardSt()}>
              <div style={{fontSize:12,color:C.muted,marginBottom:6}}>💬 本日のメモ・備考</div>
              <textarea value={currentDay?.note??""} placeholder="体調・気づきなど..."
                onChange={e=>updateDay(selWeek,selDay,{note:e.target.value})}
                style={{...inpSt(),height:70,resize:"none"}}/>
            </div>
          </div>
        )}

        {/* ══════════════ トレーニング ══════════════ */}
        {tab==="トレーニング" && (
          <TrainingTab
            weeks={weeks}
            currentWeek={currentWeek}
            currentDay={currentDay}
            selWeek={selWeek}
            selDay={selDay}
            updateDay={updateDay}
            showPraise={showPraise}
            C={C}
            cardSt={cardSt}
            inpSt={inpSt}
            btnGrad={btnGrad}
            setSelDay={setSelDay}
          />
        )}

        {/* ══════════════ 記録 ══════════════ */}
        {tab==="記録" && (
          <div style={{display:"flex",flexDirection:"column",gap:14}}>
            <div style={{display:"flex",gap:8,overflowX:"auto",paddingBottom:4}}>
              {weeks.map((w,i)=>(
                <button key={i} onClick={()=>setSelWeek(i)} style={{padding:"6px 14px",borderRadius:999,border:"none",cursor:"pointer",whiteSpace:"nowrap",fontSize:12,fontWeight:700,background:selWeek===i?`linear-gradient(135deg,${C.purple},${C.blue})`:"rgba(255,255,255,0.07)",color:selWeek===i?"#fff":C.muted}}>{w.weekLabel}</button>
              ))}
            </div>

            {/* 日々の記録 */}
            <div style={cardSt()}>
              <div style={{fontSize:13,fontWeight:700,color:C.blue,marginBottom:12}}>📋 日々の記録</div>
              {[...currentWeek?.days].reverse().map((d,i)=>{
                const realIdx = currentWeek.days.findIndex(dd=>dd.date===d.date);
                return (
                <div key={i} style={{padding:"12px 0",borderBottom:`1px solid ${C.border}`}}>
                  <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:6}}>
                    <div style={{display:"flex",alignItems:"center",gap:8}}>
                      <div style={{fontSize:13,fontWeight:700,color:C.orange}}>{d.date}</div>
                      {d.mood && <span style={{fontSize:20}}>{d.mood}</span>}
                    </div>
                    <div style={{display:"flex",gap:8,fontSize:12}}>
                      {d.morning!=null&&<span style={{color:C.yellow}}>🌅{d.morning}kg</span>}
                      {d.night!=null&&<span style={{color:C.purple}}>🌙{d.night}kg</span>}
                      {d.cal!=null&&<span style={{color:C.green}}>{d.cal}kcal</span>}
                    </div>
                  </div>
                  {/* 絵文字ピッカー */}
                  <div style={{display:"flex",gap:6,marginBottom:8,flexWrap:"wrap"}}>
                    {["😊","😆","😍","😭","😡","🤤"].map(emoji=>(
                      <button key={emoji} onClick={()=>updateDay(selWeek,realIdx,{mood: d.mood===emoji ? "" : emoji})}
                        style={{
                          fontSize:20, background: d.mood===emoji ? "rgba(255,107,53,0.25)" : "rgba(255,255,255,0.06)",
                          border: d.mood===emoji ? `1px solid ${C.orange}` : `1px solid ${C.border}`,
                          borderRadius:10, padding:"4px 8px", cursor:"pointer",
                          transform: d.mood===emoji ? "scale(1.2)" : "scale(1)",
                          transition:"all 0.15s",
                        }}>
                        {emoji}
                      </button>
                    ))}
                  </div>
                  <div style={{display:"flex",gap:8,flexWrap:"wrap",fontSize:11,color:C.muted,marginBottom:6}}>
                    {d.training?.done&&<span style={{color:C.green}}>💪{d.training.parts||"筋トレ"}</span>}
                    {d.training?.cardio>0&&<span style={{color:C.blue}}>🏃{d.training.cardio}分</span>}
                    {d.meals?.length>0&&<span>🍽️{d.meals.length}食</span>}
                  </div>
                  <input type="text" placeholder="備考を入力..." value={d.note||""}
                    onChange={e=>updateDay(selWeek,realIdx,{note:e.target.value})}
                    style={{...inpSt(),fontSize:12}}/>
                </div>
              );})}
            </div>

            {/* 週の反省 */}
            <div style={cardSt({border:`1px solid ${C.purple}44`})}>
              <div style={{fontSize:13,fontWeight:700,color:C.purple,marginBottom:12}}>📝 今週の反省・振り返り</div>
              <textarea value={currentWeek?.reflection||""} placeholder="今週を振り返って、良かったこと・改善点を記録しましょう..."
                onChange={e=>updateWeek(selWeek,{reflection:e.target.value})}
                style={{...inpSt(`${C.purple}55`),height:130,resize:"none"}}/>
            </div>
          </div>
        )}

        {/* ══════════════ カレンダー ══════════════ */}
        {tab==="カレンダー" && (
          <CalendarTab weeks={weeks} updateDay={updateDay} setTab={setTab} C={C} cardSt={cardSt} inpSt={inpSt} btnGrad={btnGrad} />
        )}

        {/* ══════════════ 設定 ══════════════ */}
        {tab==="設定" && (
          <div style={{display:"flex",flexDirection:"column",gap:14}}>

            {/* 🎯 目標設定（最上部） */}
            <div style={cardSt({border:`1px solid ${C.pink}55`,background:`linear-gradient(135deg,rgba(255,107,157,0.08),rgba(180,138,255,0.06))`})}>
              <div style={{fontSize:14,fontWeight:800,color:C.pink,marginBottom:14}}>🎯 目標設定</div>

              {/* 目標タイプ */}
              <div style={{marginBottom:14}}>
                <div style={{fontSize:11,color:C.muted,marginBottom:8,fontWeight:600}}>目標のタイプ</div>
                <div style={{display:"flex",flexWrap:"wrap",gap:8}}>
                  {["ダイエット","筋力アップ","絞る","健康維持","その他"].map(t=>(
                    <button key={t} onClick={()=>setGoal(g=>({...g,type:t}))}
                      style={{padding:"7px 16px",borderRadius:999,border:"none",cursor:"pointer",fontSize:12,fontWeight:700,
                        background:goal.type===t?`linear-gradient(135deg,${C.pink},${C.purple})`:"rgba(255,255,255,0.08)",
                        color:goal.type===t?"#fff":C.muted}}>
                      {t}
                    </button>
                  ))}
                </div>
              </div>

              {/* 数値目標 */}
              <div style={{marginBottom:12}}>
                <div style={{fontSize:11,color:C.muted,marginBottom:5,fontWeight:600}}>📊 数値の目標</div>
                <input type="text" placeholder="例：体重45kgにする、体脂肪率15%にする"
                  value={goal.targetNum} style={inpSt(`${C.pink}44`)}
                  onChange={e=>setGoal(g=>({...g,targetNum:e.target.value}))}/>
              </div>

              {/* 見た目の目標 */}
              <div style={{marginBottom:12}}>
                <div style={{fontSize:11,color:C.muted,marginBottom:5,fontWeight:600}}>✨ 見た目の目標</div>
                <textarea placeholder="例：腹筋を割りたい、二の腕を細くしたい"
                  value={goal.targetLook}
                  onChange={e=>setGoal(g=>({...g,targetLook:e.target.value}))}
                  style={{...inpSt(`${C.purple}44`),height:64,resize:"none"}}/>
              </div>

              {/* 参考画像 */}
              <div style={{marginBottom:12}}>
                <div style={{fontSize:11,color:C.muted,marginBottom:6,fontWeight:600}}>📷 参考画像（目標の体型など）</div>
                <input type="file" accept="image/*" ref={goalPhotoRef} style={{display:"none"}}
                  onChange={e=>{
                    const f=e.target.files?.[0]; if(!f) return;
                    const r=new FileReader(); r.onload=ev=>setGoal(g=>({...g,refPhoto:ev.target.result})); r.readAsDataURL(f);
                  }}/>
                {goal.refPhoto
                  ? <div>
                      <img src={goal.refPhoto} alt="goal" style={{width:"100%",borderRadius:10,maxHeight:180,objectFit:"cover",marginBottom:8}}/>
                      <button onClick={()=>setGoal(g=>({...g,refPhoto:null}))}
                        style={{padding:"7px 16px",border:`1px solid ${C.red}44`,borderRadius:8,background:"rgba(255,95,95,0.07)",color:C.red,fontSize:12,cursor:"pointer"}}>
                        🗑️ 削除
                      </button>
                    </div>
                  : <button onClick={()=>goalPhotoRef.current.click()}
                      style={{...btnGrad(C.purple,C.pink),width:"100%",padding:"10px",fontSize:13}}>
                      📷 画像を追加する
                    </button>
                }
              </div>

              {/* 期限 */}
              <div>
                <div style={{fontSize:11,color:C.muted,marginBottom:5,fontWeight:600}}>📅 いつまでに</div>
                <input type="text" placeholder="例：2025年8月、3ヶ月後"
                  value={goal.targetDate} style={inpSt(`${C.yellow}44`)}
                  onChange={e=>setGoal(g=>({...g,targetDate:e.target.value}))}/>
              </div>
            </div>

            {/* リマインド設定 */}
            <div style={cardSt({border:`1px solid ${C.teal}44`})}>
              <div style={{fontSize:14,fontWeight:700,color:C.teal,marginBottom:6}}>🔔 リマインド設定</div>
              <div style={{fontSize:12,color:C.muted,marginBottom:14}}>設定した時間にブラウザ通知で記録を促します</div>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:12}}>
                <div>
                  <div style={{fontSize:11,color:C.yellow,marginBottom:5}}>🌅 朝リマインド</div>
                  <input type="time" value={remindMorning} style={inpSt(`${C.yellow}55`)} onChange={e=>setRemindMorning(e.target.value)}/>
                </div>
                <div>
                  <div style={{fontSize:11,color:C.purple,marginBottom:5}}>🌙 夜リマインド</div>
                  <input type="time" value={remindNight} style={inpSt(`${C.purple}55`)} onChange={e=>setRemindNight(e.target.value)}/>
                </div>
              </div>
              <button onClick={setupReminders}
                style={{...btnGrad(C.teal,C.blue),width:"100%",padding:"12px",fontSize:14,marginBottom:8}}>
                🔔 リマインドを設定する
              </button>
              {remindStatus && (
                <div style={{fontSize:12,padding:"8px 12px",borderRadius:8,
                  background: remindStatus.startsWith("✅")?"rgba(74,222,128,0.1)":"rgba(255,95,95,0.1)",
                  color: remindStatus.startsWith("✅")?C.green:C.red}}>
                  {remindStatus}
                </div>
              )}
              <div style={{fontSize:11,color:C.muted,marginTop:8}}>
                ※ ブラウザを開いている間のみ通知されます。通知を許可してください。
              </div>
              {/* リマインド文例 */}
              <div style={{marginTop:12,padding:"10px 12px",background:"rgba(255,255,255,0.04)",borderRadius:10,border:`1px solid ${C.border}`}}>
                <div style={{fontSize:11,color:C.muted,marginBottom:6}}>通知メッセージ例</div>
                <div style={{fontSize:12,color:C.text,lineHeight:1.8}}>
                  🌅 「今日の記録は済みましたか？日々の記録が目標達成の近道です✨」<br/>
                  🌙 「今日もお疲れ様でした✨ 明日も頑張りましょう！」
                </div>
              </div>
            </div>

            <div style={cardSt()}>
              <div style={{fontSize:14,fontWeight:700,color:C.orange,marginBottom:16}}>⚙️ 基本情報</div>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12}}>
                {[
                  {key:"height",lbl:"身長 (cm)",ph:"158"},
                  {key:"weight",lbl:"現在の体重 (kg)",ph:"48.5"},
                  {key:"fatPct",lbl:"体脂肪率 (%)",ph:"22"},
                  {key:"maintenance",lbl:"メンテナンスカロリー",ph:"1600"},
                ].map(({key,lbl,ph})=>(
                  <div key={key}>
                    <div style={{fontSize:11,color:C.muted,marginBottom:5}}>{lbl}</div>
                    <input type="number" placeholder={`例: ${ph}`} value={profile[key]}
                      onChange={e=>setProfile({...profile,[key]:e.target.value})} style={inpSt()}/>
                  </div>
                ))}
              </div>
            </div>

            {/* データ管理 */}
            <div style={cardSt()}>
              <div style={{fontSize:14,fontWeight:700,color:C.silver,marginBottom:6}}>💾 データ管理</div>
              <div style={{fontSize:12,color:C.muted,marginBottom:14}}>
                記録はこのブラウザに自動保存されます。ブラウザを閉じても消えません。
              </div>
              <div style={{padding:"10px 14px",background:"rgba(255,255,255,0.04)",borderRadius:10,marginBottom:14,display:"flex",alignItems:"center",gap:8}}>
                <span style={{fontSize:14}}>✅</span>
                <span style={{fontSize:12,color:C.teal}}>自動保存 ON — 入力した瞬間に保存されます</span>
              </div>
              <button onClick={()=>{
                if(window.confirm("全てのデータをリセットしますか？この操作は元に戻せません。")){
                  localStorage.removeItem("shibolog_profile");
                  localStorage.removeItem("shibolog_weeks");
                  localStorage.removeItem("shibolog_goal");
                  window.location.reload();
                }
              }} style={{width:"100%",padding:"11px",border:"1px solid rgba(255,255,255,0.1)",borderRadius:10,background:"transparent",color:C.muted,fontSize:13,cursor:"pointer",fontWeight:600}}>
                🗑️ データをリセットする
              </button>
            </div>

            <div style={cardSt()}>
              <div style={{fontSize:14,fontWeight:700,color:C.teal,marginBottom:14}}>📊 計算結果</div>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
                {[
                  {lbl:"BMI",val:fmt1(calc.bmi),unit:"",color:C.teal},
                  {lbl:"除脂肪体重",val:fmt1(calc.lbm),unit:"kg",color:C.green},
                  {lbl:"体脂肪量",val:fmt1(calc.fatKg),unit:"kg",color:C.red},
                  {lbl:"目標体重",val:fmt1(calc.goalWeight),unit:"kg",color:C.purple},
                ].map(({lbl,val,unit,color})=>(
                  <div key={lbl} style={{background:"rgba(255,255,255,0.05)",borderRadius:12,padding:12,border:`1px solid ${color}33`}}>
                    <div style={{fontSize:11,color:C.muted,marginBottom:4}}>{lbl}</div>
                    <div style={{fontSize:20,fontWeight:800,color}}>{val}<span style={{fontSize:11,color:C.muted,marginLeft:3}}>{unit}</span></div>
                  </div>
                ))}
              </div>
            </div>

            <CalorieGoalCard calc={calc} /></div>
        )}

      </div>
    </div>
  );
}

// ─── カロリー目標カード（分離コンポーネント） ────────
function CalorieGoalCard({ calc }) {
  const C2 = {
    orange:"#ff6b35", teal:"#00d4aa", green:"#4ade80",
    muted:"#64748b", text:"#f0f4f8", border:"rgba(255,255,255,0.09)",
    card:"rgba(255,255,255,0.05)",
  };
  const cardSt2 = (ex={}) => ({background:C2.card,borderRadius:18,border:`1px solid ${C2.border}`,padding:18,...ex});
  const inpSt2 = (accent=C2.border) => ({width:"100%",boxSizing:"border-box",padding:"10px 13px",background:"rgba(255,255,255,0.07)",border:`1px solid ${accent}`,borderRadius:10,color:C2.text,fontSize:14,outline:"none"});
  const fmt0 = v => (v==null||isNaN(v) ? "—" : Math.round(v));

  const [cutInput,  setCutInput]  = useState("");
  const [bulkInput, setBulkInput] = useState("");

  const maintenance = calc.maintain ?? null;
  const cutVal  = cutInput  !== "" ? parseInt(cutInput)  : null;
  const bulkVal = bulkInput !== "" ? parseInt(bulkInput) : null;
  const cutDiff  = cutVal  != null && maintenance != null ? cutVal  - maintenance : null;
  const bulkDiff = bulkVal != null && maintenance != null ? bulkVal - maintenance : null;

  return (
    <div style={cardSt2()}>
      <div style={{fontSize:14,fontWeight:700,color:C2.orange,marginBottom:14}}>🎯 カロリー目標</div>

      {/* 維持（メンテ）：自動表示 */}
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"12px 14px",borderRadius:12,border:`1px solid ${C2.teal}44`,marginBottom:10,background:"rgba(255,255,255,0.03)"}}>
        <div>
          <div style={{fontSize:13,fontWeight:700}}>⚖️ 維持（メンテ）</div>
          <div style={{fontSize:11,color:C2.muted}}>基本情報から自動計算</div>
        </div>
        <div style={{fontSize:22,fontWeight:800,color:C2.teal}}>
          {fmt0(maintenance)}<span style={{fontSize:11,color:C2.muted,marginLeft:2}}>kcal</span>
        </div>
      </div>

      {/* カット：手動入力 */}
      <div style={{padding:"12px 14px",borderRadius:12,border:`1px solid ${C2.orange}44`,marginBottom:10,background:"rgba(255,255,255,0.03)"}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8}}>
          <div>
            <div style={{fontSize:13,fontWeight:700}}>🔥 減量（カット）</div>
            {cutDiff != null && (
              <div style={{fontSize:11,color: cutDiff < 0 ? C2.orange : "#f87171",marginTop:2}}>
                メンテより {cutDiff > 0 ? "+" : ""}{cutDiff} kcal
              </div>
            )}
          </div>
          {cutVal != null && (
            <div style={{fontSize:22,fontWeight:800,color:C2.orange}}>
              {cutVal}<span style={{fontSize:11,color:C2.muted,marginLeft:2}}>kcal</span>
            </div>
          )}
        </div>
        <input type="number" placeholder="目標カロリーを入力（例: 1000）"
          value={cutInput} style={inpSt2(`${C2.orange}44`)}
          onChange={e=>setCutInput(e.target.value)}/>
      </div>

      {/* バルク：手動入力 */}
      <div style={{padding:"12px 14px",borderRadius:12,border:`1px solid ${C2.green}44`,background:"rgba(255,255,255,0.03)"}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8}}>
          <div>
            <div style={{fontSize:13,fontWeight:700}}>💪 増量（バルク）</div>
            {bulkDiff != null && (
              <div style={{fontSize:11,color: bulkDiff > 0 ? C2.green : "#f87171",marginTop:2}}>
                メンテより {bulkDiff > 0 ? "+" : ""}{bulkDiff} kcal
              </div>
            )}
          </div>
          {bulkVal != null && (
            <div style={{fontSize:22,fontWeight:800,color:C2.green}}>
              {bulkVal}<span style={{fontSize:11,color:C2.muted,marginLeft:2}}>kcal</span>
            </div>
          )}
        </div>
        <input type="number" placeholder="目標カロリーを入力（例: 1800）"
          value={bulkInput} style={inpSt2(`${C2.green}44`)}
          onChange={e=>setBulkInput(e.target.value)}/>
      </div>
    </div>
  );
}

// ─── RM計算式（シャイニー薊式）────────────────────────
const calcRM = (weight, reps) => {
  const w = parseFloat(weight), r = parseFloat(reps);
  if(!w || !r || isNaN(w) || isNaN(r)) return null;
  return Math.round(w * (1 + r / 40) * 10) / 10;
};

// ─── トレーニングタブ ─────────────────────────────────
function TrainingTab({ weeks, currentWeek, currentDay, selWeek, selDay, updateDay, showPraise, C, cardSt, inpSt, btnGrad, setSelDay }) {
  const PARTS = ["Push","Pull","Leg","胸","背中","肩","腕・二頭","腕・三頭","脚","腹","臀部"];
  const MAX_SETS = 5;

  const [exName, setExName] = useState("");
  const [sets, setSets]     = useState(
    Array.from({length: MAX_SETS}, () => ({reps:"", weight:""}))
  );

  const training  = currentDay?.training || {};
  const exercises = training.exercises   || [];
  const filledSets = sets.filter(s => s.reps !== "" && s.weight !== "");

  // ── 前回同部位の記録を取得 ──────────────────────────
  // 現在選択中の部位と同じ部位でトレーニングした直近の日を探す
  const prevRecord = useMemo(() => {
    const currentParts = (training.parts||"").split(",").filter(Boolean);
    if(currentParts.length === 0) return null;

    // 全週の全日を新しい順に並べて、現在の日より前で同部位を探す
    const allDays = weeks.flatMap(w => w.days);
    const currentDateStr = currentDay?.date || "";
    const prevDays = allDays
      .filter(d => d.date !== currentDateStr && d.training?.exercises?.length > 0)
      .filter(d => {
        const dParts = (d.training?.parts||"").split(",").filter(Boolean);
        return currentParts.some(p => dParts.includes(p));
      });

    return prevDays.length > 0 ? prevDays[prevDays.length - 1] : null;
  }, [weeks, currentDay, training.parts]);

  // 入力中の種目名と一致する前回の記録を取得
  const prevExercise = useMemo(() => {
    if(!exName || !prevRecord) return null;
    return prevRecord.training?.exercises?.find(e =>
      e.name.includes(exName) || exName.includes(e.name)
    ) || null;
  }, [exName, prevRecord]);

  function updateSet(idx, field, val) {
    setSets(prev => prev.map((s, i) => i === idx ? {...s, [field]: val} : s));
  }

  function addExercise() {
    if(!exName || filledSets.length === 0) return;
    const setsWithRM = filledSets.map((s, i) => ({
      setNo: i + 1,
      reps:   s.reps,
      weight: s.weight,
      rm:     calcRM(s.weight, s.reps),
    }));
    const bestRM = Math.max(...setsWithRM.map(s => s.rm || 0));
    const ex = { id: Date.now(), name: exName, sets: setsWithRM, bestRM };
    updateDay(selWeek, selDay, {
      training: { ...training, exercises: [...exercises, ex], done: true }
    });
    setExName("");
    setSets(Array.from({length: MAX_SETS}, () => ({reps:"", weight:""})));
    showPraise("training");
  }

  function removeExercise(id) {
    updateDay(selWeek, selDay, {
      training: { ...training, exercises: exercises.filter(e => e.id !== id) }
    });
  }

  function togglePart(part) {
    const parts = (training.parts||"").split(",").filter(Boolean);
    const next  = parts.includes(part) ? parts.filter(p=>p!==part) : [...parts, part];
    updateDay(selWeek, selDay, { training: { ...training, parts: next.join(",") }});
  }

  // 全体の最高RM
  const allBestRM = exercises.length
    ? exercises.reduce((best, ex) => ex.bestRM > best.rm ? {name: ex.name, rm: ex.bestRM} : best, {name:"", rm:0})
    : null;

  return (
    <div style={{display:"flex",flexDirection:"column",gap:14}}>

      {/* 日付セレクタ */}
      <div style={{display:"flex",gap:6,overflowX:"auto",paddingBottom:4}}>
        {currentWeek?.days.map((d,i)=>(
          <button key={i} onClick={()=>setSelDay(i)} style={{
            padding:"6px 12px",borderRadius:999,border:"none",cursor:"pointer",
            whiteSpace:"nowrap",fontSize:12,fontWeight:700,
            background:selDay===i?`linear-gradient(135deg,${C.orange},${C.pink})`:"rgba(255,255,255,0.07)",
            color:selDay===i?"#fff":C.muted
          }}>{d.date}</button>
        ))}
      </div>

      {/* 基本情報 */}
      <div style={cardSt()}>
        <div style={{display:"flex",alignItems:"center",gap:12,marginBottom:14}}>
          <div style={{fontSize:13,fontWeight:700,color:C.orange}}>💪 {currentDay?.date}</div>
          <button onClick={()=>{
            const nd=!training.done;
            updateDay(selWeek,selDay,{training:{...training,done:nd}});
            if(nd) showPraise("training");
          }} style={{marginLeft:"auto",padding:"7px 18px",border:"none",borderRadius:999,cursor:"pointer",fontWeight:700,fontSize:12,
            background:training.done?`linear-gradient(135deg,${C.green},${C.teal})`:"rgba(255,255,255,0.07)",
            color:training.done?"#000":C.muted}}>
            {training.done?"✅ 筋トレあり":"筋トレなし"}
          </button>
        </div>

        {/* 部位 */}
        <div style={{marginBottom:14}}>
          <div style={{fontSize:11,color:C.muted,marginBottom:8}}>部位（複数選択可）</div>
          <div style={{display:"flex",flexWrap:"wrap",gap:8}}>
            {PARTS.map(part=>{
              const active = (training.parts||"").split(",").includes(part);
              return (
                <button key={part} onClick={()=>togglePart(part)}
                  style={{padding:"6px 13px",border:"none",borderRadius:999,cursor:"pointer",fontSize:12,fontWeight:700,
                    background:active?`linear-gradient(135deg,${C.orange},${C.pink})`:"rgba(255,255,255,0.07)",
                    color:active?"#fff":C.muted}}>
                  {part}
                </button>
              );
            })}
          </div>
        </div>

        {/* 有酸素 */}
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
          <div>
            <div style={{fontSize:11,color:C.blue,marginBottom:5}}>🏃 有酸素 (分)</div>
            <input type="number" placeholder="0" value={training.cardio||""} style={inpSt(`${C.blue}55`)}
              onChange={e=>updateDay(selWeek,selDay,{training:{...training,cardio:parseInt(e.target.value)||0}})}/>
          </div>
          <div>
            <div style={{fontSize:11,color:C.red,marginBottom:5}}>🔥 消費カロリー (kcal)</div>
            <input type="number" placeholder="0" value={training.cardioKcal||""} style={inpSt(`${C.red}55`)}
              onChange={e=>updateDay(selWeek,selDay,{training:{...training,cardioKcal:parseInt(e.target.value)||0}})}/>
          </div>
        </div>
      </div>

      {/* ─── 種目入力フォーム ─── */}
      <div style={cardSt({border:`1px solid ${C.orange}44`})}>
        <div style={{fontSize:13,fontWeight:700,color:C.orange,marginBottom:14}}>➕ 種目を追加</div>

        {/* 種目名 */}
        <div style={{marginBottom:14}}>
          <div style={{fontSize:11,color:C.muted,marginBottom:5}}>種目名</div>
          <input type="text" placeholder="例: ベンチプレス、スクワット、デッドリフト"
            value={exName} style={inpSt()}
            onChange={e=>setExName(e.target.value)}/>
        </div>

        {/* 前回の同種目記録 */}
        {prevExercise && (
          <div style={{marginBottom:12,padding:"10px 12px",borderRadius:10,
            background:"rgba(94,174,255,0.07)",border:`1px solid ${C.blue}33`}}>
            <div style={{fontSize:10,color:C.blue,fontWeight:700,marginBottom:6}}>
              📖 前回の記録（{prevRecord.date}）
            </div>
            <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
              {prevExercise.sets.map((s,si)=>(
                <div key={si} style={{fontSize:11,padding:"3px 9px",borderRadius:999,
                  background:`${C.blue}18`,color:C.blue,fontWeight:600}}>
                  Set{s.setNo} {s.weight}kg×{s.reps}回
                  {s.rm&&<span style={{color:C.muted,marginLeft:3}}>1RM:{s.rm}kg</span>}
                </div>
              ))}
            </div>
            <div style={{fontSize:10,color:C.muted,marginTop:4}}>
              前回最高1RM：<span style={{color:C.orange,fontWeight:700}}>{prevExercise.bestRM}kg</span>
            </div>
          </div>
        )}

        {/* 前回同部位セッション全体の記録（種目名未入力時） */}
        {!exName && prevRecord && (
          <div style={{marginBottom:12,padding:"10px 12px",borderRadius:10,
            background:"rgba(94,174,255,0.05)",border:`1px solid ${C.blue}22`}}>
            <div style={{fontSize:10,color:C.blue,fontWeight:700,marginBottom:6}}>
              📖 前回同部位のセッション（{prevRecord.date}）
            </div>
            {prevRecord.training.exercises.map((ex,ei)=>(
              <div key={ei} style={{marginBottom:4}}>
                <span style={{fontSize:12,fontWeight:700,color:C.text}}>{ex.name}</span>
                <span style={{fontSize:10,color:C.muted,marginLeft:6}}>
                  {ex.sets.length}セット・最高1RM {ex.bestRM}kg
                </span>
              </div>
            ))}
          </div>
        )}

        {/* セット別入力 */}
        <div style={{fontSize:11,color:C.muted,marginBottom:10}}>セットごとに入力（最大5セット）</div>

        {/* ヘッダー */}
        <div style={{display:"grid",gridTemplateColumns:"36px 1fr 1fr 80px",gap:6,marginBottom:6,padding:"0 4px"}}>
          <div style={{fontSize:10,color:C.muted,textAlign:"center"}}>SET</div>
          <div style={{fontSize:10,color:C.yellow}}>回数</div>
          <div style={{fontSize:10,color:C.purple}}>重量 (kg)</div>
          <div style={{fontSize:10,color:C.orange,textAlign:"center"}}>推定1RM</div>
        </div>

        {sets.map((s, i) => {
          const rm = calcRM(s.weight, s.reps);
          return (
            <div key={i} style={{
              display:"grid", gridTemplateColumns:"36px 1fr 1fr 80px",
              gap:6, marginBottom:8, alignItems:"center",
            }}>
              {/* SET番号 */}
              <div style={{
                width:30, height:30, borderRadius:"50%", display:"flex",
                alignItems:"center", justifyContent:"center", fontSize:12, fontWeight:800,
                background: s.reps && s.weight
                  ? `linear-gradient(135deg,${C.orange},${C.pink})`
                  : "rgba(255,255,255,0.08)",
                color: s.reps && s.weight ? "#fff" : C.muted,
              }}>{i+1}</div>

              {/* 回数 */}
              <input type="number" placeholder="回数"
                value={s.reps} style={{...inpSt(`${C.yellow}44`), padding:"9px 10px", fontSize:14}}
                onChange={e=>updateSet(i,"reps",e.target.value)}/>

              {/* 重量 */}
              <input type="number" placeholder="kg"
                value={s.weight} style={{...inpSt(`${C.purple}44`), padding:"9px 10px", fontSize:14}}
                onChange={e=>updateSet(i,"weight",e.target.value)}/>

              {/* 推定1RM（即時表示） */}
              <div style={{
                textAlign:"center", padding:"6px 4px", borderRadius:8,
                background: rm ? `${C.orange}18` : "rgba(255,255,255,0.04)",
                border: rm ? `1px solid ${C.orange}44` : `1px solid ${C.border}`,
              }}>
                {rm
                  ? <><span style={{fontSize:14,fontWeight:800,color:C.orange}}>{rm}</span><span style={{fontSize:9,color:C.muted}}>kg</span></>
                  : <span style={{fontSize:10,color:C.dim}}>—</span>
                }
              </div>
            </div>
          );
        })}

        {/* 入力済みセット数表示 */}
        {filledSets.length > 0 && (
          <div style={{fontSize:12,color:C.teal,marginBottom:10,fontWeight:700}}>
            ✅ {filledSets.length}セット入力済み
          </div>
        )}

        <button onClick={addExercise} disabled={!exName || filledSets.length === 0}
          style={{...btnGrad(C.orange,C.pink),width:"100%",padding:"13px",fontSize:14,
            opacity: (!exName || filledSets.length === 0) ? 0.4 : 1}}>
          ＋ この種目を記録する
        </button>
      </div>

      {/* ─── 1日の記録まとめ ─── */}
      {exercises.length > 0 && (
        <div style={cardSt()}>
          <div style={{fontSize:14,fontWeight:800,color:C.teal,marginBottom:14}}>
            📋 {currentDay?.date} のトレーニング記録
          </div>

          {/* 最高推定1RM */}
          {allBestRM && allBestRM.rm > 0 && (
            <div style={{marginBottom:14,padding:"12px 14px",borderRadius:12,
              background:`linear-gradient(135deg,rgba(255,209,102,0.13),rgba(255,107,53,0.1))`,
              border:`1px solid ${C.yellow}44`}}>
              <div style={{fontSize:10,color:C.yellow,fontWeight:700,marginBottom:2}}>🏆 本日の最高推定1RM</div>
              <div style={{fontSize:18,fontWeight:800,color:C.yellow}}>
                {allBestRM.name}　{allBestRM.rm}kg
              </div>
            </div>
          )}

          {/* 種目ごとの記録 */}
          {exercises.map((ex, ei) => (
            <div key={ex.id} style={{
              marginBottom:12, padding:"14px",
              background:"rgba(255,255,255,0.04)",
              borderRadius:14, border:`1px solid ${C.border}`,
            }}>
              {/* 種目ヘッダー */}
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10}}>
                <div style={{fontSize:14,fontWeight:800,color:C.text}}>{ex.name}</div>
                <div style={{display:"flex",alignItems:"center",gap:8}}>
                  {ex.bestRM > 0 && (
                    <span style={{fontSize:11,padding:"3px 10px",borderRadius:999,
                      background:`${C.orange}22`,color:C.orange,fontWeight:700}}>
                      MAX {ex.bestRM}kg
                    </span>
                  )}
                  <button onClick={()=>removeExercise(ex.id)}
                    style={{background:"rgba(255,95,95,0.15)",border:"none",borderRadius:6,
                      padding:"3px 8px",color:C.red,fontSize:11,cursor:"pointer"}}>
                    削除
                  </button>
                </div>
              </div>

              {/* セット一覧テーブル */}
              <div style={{display:"grid",gridTemplateColumns:"36px 1fr 1fr 80px",gap:4,marginBottom:4}}>
                <div style={{fontSize:9,color:C.muted,textAlign:"center"}}>SET</div>
                <div style={{fontSize:9,color:C.yellow}}>回数</div>
                <div style={{fontSize:9,color:C.purple}}>重量</div>
                <div style={{fontSize:9,color:C.orange,textAlign:"center"}}>推定1RM</div>
              </div>
              {ex.sets.map((s,si)=>(
                <div key={si} style={{display:"grid",gridTemplateColumns:"36px 1fr 1fr 80px",gap:4,marginBottom:4,alignItems:"center"}}>
                  <div style={{
                    width:26,height:26,borderRadius:"50%",display:"flex",alignItems:"center",justifyContent:"center",
                    fontSize:11,fontWeight:800,
                    background:`linear-gradient(135deg,${C.orange}88,${C.pink}88)`,color:"#fff",
                  }}>{s.setNo}</div>
                  <div style={{fontSize:13,fontWeight:700,color:C.yellow}}>{s.reps}回</div>
                  <div style={{fontSize:13,fontWeight:700,color:C.purple}}>{s.weight}kg</div>
                  <div style={{textAlign:"center",fontSize:13,fontWeight:800,color:C.orange}}>{s.rm}kg</div>
                </div>
              ))}
            </div>
          ))}
        </div>
      )}

      {/* 週まとめ */}
      <div style={cardSt()}>
        <div style={{fontSize:13,fontWeight:700,color:C.green,marginBottom:12}}>📅 今週のまとめ</div>
        {[...currentWeek?.days].reverse().map((d,i)=>(
          <div key={i} style={{padding:"10px 0",borderBottom:`1px solid ${C.border}`}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom: d.training?.exercises?.length ? 6 : 0}}>
              <div style={{fontSize:13,fontWeight:700,color:C.orange}}>{d.date}</div>
              <div style={{fontSize:12,display:"flex",gap:8}}>
                {d.training?.done
                  ?<span style={{color:C.green}}>💪{d.training.parts||"筋トレ"}</span>
                  :<span style={{color:C.muted}}>休養日</span>}
                {d.training?.exercises?.length>0&&
                  <span style={{color:C.teal}}>{d.training.exercises.length}種目</span>}
                {d.training?.cardio>0&&
                  <span style={{color:C.blue}}>🏃{d.training.cardio}分</span>}
              </div>
            </div>
            {/* 種目名一覧 */}
            {d.training?.exercises?.length > 0 && (
              <div style={{display:"flex",flexWrap:"wrap",gap:6}}>
                {d.training.exercises.map((ex,ei)=>(
                  <span key={ei} style={{fontSize:11,padding:"2px 10px",borderRadius:999,
                    background:`${C.orange}18`,color:C.orange,fontWeight:600}}>
                    {ex.name}
                    {ex.bestRM > 0 && <span style={{color:C.muted,marginLeft:3}}>1RM {ex.bestRM}kg</span>}
                  </span>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── カレンダータブ（月間） ───────────────────────────
function CalendarTab({ weeks, updateDay, setTab, C, cardSt, inpSt, btnGrad }) {
  const today = new Date();
  const [viewYear,  setViewYear]  = useState(today.getFullYear());
  const [viewMonth, setViewMonth] = useState(today.getMonth());
  const [selected,  setSelected]  = useState(null);
  const [scheduleInput, setScheduleInput] = useState("");

  const dayMap = useMemo(() => {
    const map = {};
    weeks.forEach(w => w.days.forEach((d, di) => {
      map[d.date] = { ...d, weekIdx: weeks.indexOf(w), dayIdx: di };
    }));
    return map;
  }, [weeks]);

  const firstDay = new Date(viewYear, viewMonth, 1);
  const lastDay  = new Date(viewYear, viewMonth + 1, 0);
  const startDow = (firstDay.getDay() + 6) % 7;
  const totalDays = lastDay.getDate();
  const weeksCount = Math.ceil((startDow + totalDays) / 7);
  const MONTH_JP = ["1月","2月","3月","4月","5月","6月","7月","8月","9月","10月","11月","12月"];
  const DOW = ["月","火","水","木","金","土","日"];
  const MOODS = ["😊","😆","😍","😭","😡","🤤"];

  function prevMonth() {
    if(viewMonth===0){setViewYear(y=>y-1);setViewMonth(11);}else setViewMonth(m=>m-1);
  }
  function nextMonth() {
    if(viewMonth===11){setViewYear(y=>y+1);setViewMonth(0);}else setViewMonth(m=>m+1);
  }

  const selectedData = selected ? dayMap[selected] : null;

  function saveSchedule() {
    if(!selectedData || !scheduleInput.trim()) return;
    updateDay(selectedData.weekIdx, selectedData.dayIdx, { schedule: scheduleInput.trim() });
    setScheduleInput("");
  }

  function setMood(emoji) {
    if(!selectedData) return;
    updateDay(selectedData.weekIdx, selectedData.dayIdx, { mood: selectedData.mood===emoji ? "" : emoji });
  }

  return (
    <div style={{display:"flex",flexDirection:"column",gap:14}}>
      <div style={cardSt()}>
        {/* ナビ */}
        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:14}}>
          <button onClick={prevMonth} style={{background:"rgba(255,255,255,0.08)",border:"none",borderRadius:8,padding:"8px 14px",color:"#f0f4f8",fontSize:18,cursor:"pointer"}}>‹</button>
          <div style={{fontSize:16,fontWeight:800,color:C.purple}}>{viewYear}年 {MONTH_JP[viewMonth]}</div>
          <button onClick={nextMonth} style={{background:"rgba(255,255,255,0.08)",border:"none",borderRadius:8,padding:"8px 14px",color:"#f0f4f8",fontSize:18,cursor:"pointer"}}>›</button>
        </div>
        {/* 曜日 */}
        <div style={{display:"grid",gridTemplateColumns:"repeat(7,1fr)",gap:2,marginBottom:4}}>
          {DOW.map(d=>(
            <div key={d} style={{textAlign:"center",fontSize:10,fontWeight:700,
              color:d==="日"?C.red:d==="土"?C.blue:C.muted,padding:"4px 0"}}>{d}</div>
          ))}
        </div>
        {/* 日付グリッド */}
        <div style={{display:"grid",gridTemplateColumns:"repeat(7,1fr)",gap:2}}>
          {Array.from({length:weeksCount*7}).map((_,idx)=>{
            const dayNum = idx - startDow + 1;
            if(dayNum<1||dayNum>totalDays) return <div key={idx} style={{minHeight:56}}/>;
            const dateKey = `${viewMonth+1}/${dayNum}`;
            const d = dayMap[dateKey];
            const isToday = viewYear===today.getFullYear()&&viewMonth===today.getMonth()&&dayNum===today.getDate();
            const isSelected = selected===dateKey;
            const hasTrain = d?.training?.done;
            const parts = (d?.training?.parts||"").split(",").filter(Boolean);
            const dow = (startDow+dayNum-1)%7;
            return (
              <div key={idx} onClick={()=>setSelected(isSelected?null:dateKey)}
                style={{minHeight:56,borderRadius:10,padding:"4px 3px",cursor:"pointer",textAlign:"center",
                  background:isSelected?`linear-gradient(135deg,${C.purple}44,${C.blue}33)`:hasTrain?"rgba(255,107,53,0.1)":"rgba(255,255,255,0.04)",
                  border:isSelected?`1.5px solid ${C.purple}`:isToday?`1.5px solid ${C.teal}`:`1px solid rgba(255,255,255,0.09)`,
                  display:"flex",flexDirection:"column",alignItems:"center",gap:1}}>
                <div style={{fontSize:11,fontWeight:800,
                  color:isToday?C.teal:dow===6?C.red:dow===5?C.blue:hasTrain?C.orange:"#f0f4f8"}}>{dayNum}</div>
                {d?.mood&&<div style={{fontSize:13,lineHeight:1}}>{d.mood}</div>}
                {parts.slice(0,1).map((p,pi)=>(
                  <div key={pi} style={{fontSize:7,fontWeight:700,background:`${C.orange}22`,color:C.orange,borderRadius:3,padding:"1px 3px",maxWidth:"100%",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{p}</div>
                ))}
                {d?.schedule&&<div style={{fontSize:7,color:C.teal,maxWidth:"100%",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{d.schedule}</div>}
              </div>
            );
          })}
        </div>
      </div>

      {/* 選択日の詳細 */}
      {selected && (
        <div style={cardSt({border:`1px solid ${C.purple}44`})}>
          <div style={{fontSize:13,fontWeight:700,color:C.purple,marginBottom:12}}>📌 {selected}</div>

          {/* 気分 */}
          <div style={{marginBottom:12}}>
            <div style={{fontSize:11,color:C.muted,marginBottom:6}}>気分</div>
            <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
              {MOODS.map(emoji=>(
                <button key={emoji} onClick={()=>setMood(emoji)}
                  style={{fontSize:20,background:selectedData?.mood===emoji?"rgba(180,138,255,0.25)":"rgba(255,255,255,0.06)",
                    border:selectedData?.mood===emoji?`1px solid ${C.purple}`:`1px solid rgba(255,255,255,0.09)`,
                    borderRadius:10,padding:"4px 8px",cursor:"pointer"}}>{emoji}</button>
              ))}
            </div>
          </div>

          {/* 記録サマリー */}
          {selectedData&&(
            <div style={{marginBottom:12,padding:"10px 12px",background:"rgba(255,255,255,0.04)",borderRadius:10}}>
              <div style={{fontSize:11,color:C.muted,marginBottom:6}}>この日の記録</div>
              <div style={{display:"flex",gap:10,flexWrap:"wrap",fontSize:12}}>
                {selectedData.morning!=null&&<span style={{color:C.yellow}}>🌅{selectedData.morning}kg</span>}
                {selectedData.night!=null&&<span style={{color:C.purple}}>🌙{selectedData.night}kg</span>}
                {selectedData.training?.done&&<span style={{color:C.green}}>💪{selectedData.training.parts||"筋トレ"}</span>}
                {selectedData.training?.exercises?.length>0&&<span style={{color:C.teal}}>{selectedData.training.exercises.length}種目</span>}
              </div>
              <div style={{display:"flex",gap:8,marginTop:10}}>
                <button onClick={()=>setTab("記録")} style={{...btnGrad(C.blue,C.purple),padding:"7px 14px",fontSize:12,borderRadius:8}}>📋 記録へ</button>
                <button onClick={()=>setTab("トレーニング")} style={{...btnGrad(C.orange,C.pink),padding:"7px 14px",fontSize:12,borderRadius:8}}>💪 筋トレへ</button>
              </div>
            </div>
          )}

          {/* 予定入力 */}
          <div>
            <div style={{fontSize:11,color:C.muted,marginBottom:6}}>📝 予定・メモ</div>
            {selectedData?.schedule&&(
              <div style={{fontSize:12,color:C.teal,marginBottom:6,padding:"6px 10px",background:"rgba(0,212,170,0.08)",borderRadius:8}}>
                {selectedData.schedule}
              </div>
            )}
            <div style={{display:"flex",gap:8}}>
              <input type="text" placeholder="予定を入力..."
                value={scheduleInput} onChange={e=>setScheduleInput(e.target.value)}
                onKeyDown={e=>e.key==="Enter"&&saveSchedule()}
                style={{...inpSt(),flex:1,fontSize:13}}/>
              <button onClick={saveSchedule}
                style={{...btnGrad(C.teal,C.blue),padding:"10px 16px",fontSize:13,borderRadius:10,whiteSpace:"nowrap"}}>保存</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
