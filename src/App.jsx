import { useState, useMemo, useRef, useCallback, useEffect } from "react";
import {
  LineChart, Line, BarChart, Bar,
  XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, ReferenceLine
} from "recharts";

// ══════════════════════════════════════════════════
//  保存キー一覧（v3に統一・過去キーと完全分離）
//  shibolog_v3_profile  : 身長・体重・体脂肪率・メンテカロリー
//  shibolog_v3_fatgoal  : 目標体脂肪率・1日不足カロリー
//  shibolog_v3_weeks    : 全週データ（体重/食事/筋トレ/気分/メモ）
//  shibolog_v3_goal     : 目標設定（タイプ/数値/見た目/日程/画像）
// ══════════════════════════════════════════════════
const KEYS = {
  profile : "shibolog_v3_profile",
  fatgoal : "shibolog_v3_fatgoal",
  weeks   : "shibolog_v3_weeks",
  goal    : "shibolog_v3_goal",
};

// ─── localStorage ラッパー（失敗しても落ちない）─────
function lsGet(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    if (raw == null) return fallback;
    return JSON.parse(raw);
  } catch { return fallback; }
}
function lsSet(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch (e) {
    console.warn("localStorage保存失敗:", key, e);
    return false;
  }
}

// ─── カラー ──────────────────────────────────────
const C = {
  bg:"#1a1a1a", bg2:"#242424", card:"rgba(255,255,255,0.04)",
  border:"rgba(255,255,255,0.08)",
  orange:"#d4b896", yellow:"#c8b89a", teal:"#9aaa9a",
  purple:"#b0a898", blue:"#8a9aaa", pink:"#c4a090",
  green:"#8aaa8a", red:"#c08080",
  text:"#e8e4e0", muted:"#7a7570", dim:"#2e2b28",
  gold:"#c9a84c", white:"#f0ede8", silver:"#9a9590",
};

// ─── フォーマット ────────────────────────────────
const fmt1    = v => (v==null||isNaN(v)?"—":Number(v).toFixed(1));
const fmt2    = v => (v==null||isNaN(v)?"—":Number(v).toFixed(2));
const fmt0    = v => (v==null||isNaN(v)?"—":Math.round(v));
const fmtCeil = v => (v==null||isNaN(v)?"—":Math.ceil(v));

// ─── 計算：プロフィール ───────────────────────────
function calcProfile({ height, weight, fatPct, maintenance }) {
  const h=parseFloat(height), w=parseFloat(weight),
        f=parseFloat(fatPct),  m=parseFloat(maintenance);
  if (!h || !w) return {};
  const bmi     = w / ((h/100)**2);
  const lbm     = !isNaN(f) ? w*(1-f/100) : null;
  const fatKg   = !isNaN(f) ? w*(f/100)   : null;
  const tdee    = (!isNaN(m)&&m>0) ? m : (10*w+6.25*h-5*30+5)*1.55;
  const cut     = Math.round(tdee-500);
  const maintain= Math.round(tdee);
  const bulk    = Math.round(tdee+300);
  const protein = lbm ? Math.round(lbm*2.2) : Math.round(w*2);
  const fat2    = Math.round((cut*0.25)/9);
  const carb    = Math.round((cut-protein*4-fat2*9)/4);
  const goalWeight = lbm ? Math.round(lbm/0.85*10)/10 : null;
  return { bmi, lbm, fatKg, tdee, cut, maintain, bulk, protein, fat:fat2, carb, goalWeight };
}

// ─── 計算：目標体脂肪率 ──────────────────────────
function calcFatGoal({ weight, fatPct, targetFatPct, dailyDeficit }) {
  const w=parseFloat(weight), f=parseFloat(fatPct),
        tf=parseFloat(targetFatPct), dd=parseFloat(dailyDeficit);
  const errors = [];
  if (!w||w<=0)         errors.push("体重は0より大きい数値を入力してください");
  if (!f||f<=0||f>=100) errors.push("現在の体脂肪率は0〜100の間で入力してください");
  if (errors.length) return { errors };
  if (!tf||tf<=0||tf>=f) {
    const fatKg = w*(f/100);
    return { errors:[], partial:true,
      fatKg, lbm:w-fatKg, fatPerPct:fatKg/f,
      needFatLoss:null, totalDeficit:null, days:null, weeks:null };
  }
  const fatKg        = w*(f/100);
  const lbm          = w-fatKg;
  const fatPerPct    = fatKg/f;
  const needFatLoss  = (f-tf)*fatPerPct;
  const totalDeficit = needFatLoss*7200;
  const days         = (dd&&dd>0) ? totalDeficit/dd : null;
  const weeks2       = days!=null ? days/7 : null;
  // 目標体重 = 除脂肪体重 ÷ (1 - 目標体脂肪率/100)
  const goalWeight   = lbm / (1 - tf/100);
  // 目標までの-kg = 現在体重 - 目標体重
  const diffKg       = w - goalWeight;
  return { errors:[], partial:false, fatKg, lbm, fatPerPct, needFatLoss, totalDeficit, days, weeks:weeks2, goalWeight, diffKg };
}

// ─── 日付ユーティリティ ──────────────────────────
function getMonday(date) {
  const d = new Date(date);
  const day = d.getDay();
  d.setDate(d.getDate() + (day===0 ? -6 : 1-day));
  d.setHours(0,0,0,0);
  return d;
}
function makeDateKey(date)  { return `${date.getMonth()+1}/${date.getDate()}`; }
function makeFullKey(date)  { return `${date.getFullYear()}-${date.getMonth()+1}-${date.getDate()}`; }
function makeWeekLabel(monday) {
  const sun = new Date(monday); sun.setDate(monday.getDate()+6);
  return `${makeDateKey(monday)}〜${makeDateKey(sun)}`;
}
function makeEmptyDay(date) {
  return {
    date:     makeDateKey(date),
    fullKey:  makeFullKey(date),
    year:     date.getFullYear(),
    morning:  null, night: null, cal: null,
    meals:    [], mood: "",
    training: { done:false, parts:"", cardio:0, cardioKcal:0, exercises:[] },
    note:     "", schedule: "",
  };
}
function makeEmptyWeek(monday) {
  return {
    weekLabel:   makeWeekLabel(monday),
    mondayFull:  makeFullKey(monday),   // ← ソート・照合用（確実な年付きキー）
    reflection:  "",
    days: Array.from({length:7}, (_,i) => {
      const d = new Date(monday); d.setDate(monday.getDate()+i);
      return makeEmptyDay(d);
    }),
  };
}
function buildInitialWeeks() {
  const today = new Date();
  const mon   = getMonday(today);
  const prev  = new Date(mon); prev.setDate(mon.getDate()-7);
  return [makeEmptyWeek(prev), makeEmptyWeek(mon)];
}

// mondayFull でソート（年をまたいでも正しく並ぶ）
function sortWeeks(ws) {
  return [...ws].sort((a,b) => {
    const da = new Date(a.mondayFull?.replace(/-/g,"/") || "2000/1/1");
    const db = new Date(b.mondayFull?.replace(/-/g,"/") || "2000/1/1");
    return da - db;
  });
}

// 指定日を含む週が存在しなければ追加して返す
function ensureWeek(weeks, dateObj) {
  const mon   = getMonday(dateObj);
  const label = makeWeekLabel(mon);
  if (weeks.some(w => w.weekLabel===label)) return weeks;
  return sortWeeks([...weeks, makeEmptyWeek(mon)]);
}

// ─── スタイルヘルパー ────────────────────────────
const cardSt  = (ex={}) => ({ background:"#222220", borderRadius:14, border:"1px solid rgba(255,255,255,0.07)", padding:18, ...ex });
const inpSt   = (ac="rgba(255,255,255,0.1)") => ({ width:"100%", boxSizing:"border-box", padding:"11px 14px", background:"#2a2826", border:`1px solid ${ac}`, borderRadius:10, color:C.text, fontSize:14, outline:"none" });
const btnGrad = (a,b,ex={}) => ({ border:"none", borderRadius:10, cursor:"pointer", fontWeight:700, color:C.white, background:`linear-gradient(135deg,${a},${b})`, ...ex });

const TABS  = ["ダッシュボード","食事","トレーニング","記録","カレンダー","設定"];
const TICON = ["📊","🍽️","💪","📋","📅","⚙️"];
const PRAISE = {
  morning: ["🌅 朝の記録お疲れ様！その積み重ねが結果につながるよ✨","☀️ 朝から記録できてる、すごい！継続は力なり💪"],
  night:   ["🌙 今日も一日お疲れ様でした✨","⭐ 夜まで記録続けてる、本当に頑張ってる！明日も一緒に頑張ろう💫"],
  meal:    ["🍽️ 食事記録バッチリ！意識して食べることが大事✨","✅ 記録してえらい！食べたものを把握できてるね💪"],
  training:["💪 トレーニング記録した！動いた日は必ず体が変わってる✨","🔥 筋トレ記録完了！その努力、絶対に裏切らないよ💫"],
};
const getRandom = arr => arr[Math.floor(Math.random()*arr.length)];

// ══════════════════════════════════════════════════
//  メインコンポーネント
// ══════════════════════════════════════════════════
export default function DietTracker() {
  const [tab, setTab] = useState("ダッシュボード");

  // ── state初期化：必ず保存済みデータを優先 ────────
  const [profile, setProfile] = useState(() =>
    lsGet(KEYS.profile, { height:"", weight:"", fatPct:"", maintenance:"" })
  );
  const [fatGoalInput, setFatGoalInput] = useState(() =>
    lsGet(KEYS.fatgoal, { targetFatPct:"", dailyDeficit:"" })
  );
  const [goal, setGoal] = useState(() =>
    lsGet(KEYS.goal, { type:"", targetNum:"", targetLook:"", targetDate:"", refPhoto:null })
  );

  // weeks: 保存済みを最優先で復元。今週がなければ追加する
  const [weeks, setWeeks] = useState(() => {
    const saved = lsGet(KEYS.weeks, null);
    if (saved && Array.isArray(saved) && saved.length > 0) {
      // 古いデータに mondayFull がなければ補完する
      const patched = saved.map(w => {
        if (w.mondayFull) return w;
        // weekLabel "4/21〜4/27" から月初日を取り出して補完
        try {
          const [mStr, dStr] = w.weekLabel.split("〜")[0].split("/");
          const year = new Date().getFullYear();
          const mon  = getMonday(new Date(year, parseInt(mStr)-1, parseInt(dStr)));
          return { ...w, mondayFull: makeFullKey(mon) };
        } catch { return { ...w, mondayFull: "2024-1-1" }; }
      });
      // 今週があるか確認し、なければ追加
      const today  = new Date();
      const patched2 = ensureWeek(patched, today);
      return sortWeeks(patched2);
    }
    return buildInitialWeeks();
  });

  // ── selWeek：ラベル文字列で管理（index依存をやめる）
  // indexではなくweekLabelを保持することで、weeks配列が変わってもズレない
  const [selWeekLabel, setSelWeekLabel] = useState(() => {
    const today = new Date();
    return makeWeekLabel(getMonday(today));
  });
  const selWeek = useMemo(() => {
    const idx = weeks.findIndex(w => w.weekLabel === selWeekLabel);
    return idx >= 0 ? idx : weeks.length - 1;
  }, [weeks, selWeekLabel]);

  const [selDay, setSelDay] = useState(() => {
    const day = new Date().getDay();
    return day===0 ? 6 : day-1;
  });

  // ── 保存ステータス表示 ───────────────────────────
  const [saveStatus, setSaveStatus] = useState(""); // "saved" | "error" | ""
  const saveTimer = useRef(null);
  function showSaved(ok=true) {
    setSaveStatus(ok ? "saved" : "error");
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => setSaveStatus(""), 2000);
  }

  // ── 確実な自動保存（useEffect + 直接保存の2段構え）
  useEffect(() => { showSaved(lsSet(KEYS.profile, profile)); }, [profile]);
  useEffect(() => { showSaved(lsSet(KEYS.weeks,   weeks));   }, [weeks]);
  useEffect(() => { showSaved(lsSet(KEYS.goal,    goal));    }, [goal]);
  useEffect(() => { showSaved(lsSet(KEYS.fatgoal, fatGoalInput)); }, [fatGoalInput]);

  // ── その他state ──────────────────────────────────
  const [mealForm, setMealForm]   = useState({ time:"", name:"", kcal:"", protein:"", fat:"", carb:"", photo:null });
  const [praiseMsg, setPraiseMsg] = useState("");
  const [bodyPhoto, setBodyPhoto] = useState(null);
  const bodyPhotoRef = useRef();
  const goalPhotoRef = useRef();
  const photoRef     = useRef();
  const [remindMorning, setRemindMorning] = useState("07:00");
  const [remindNight,   setRemindNight]   = useState("21:00");
  const [remindStatus,  setRemindStatus]  = useState("");

  const calc        = useMemo(() => calcProfile(profile), [profile]);
  const fatGoalCalc = useMemo(() => calcFatGoal({
    weight:profile.weight, fatPct:profile.fatPct,
    targetFatPct:fatGoalInput.targetFatPct, dailyDeficit:fatGoalInput.dailyDeficit,
  }), [profile, fatGoalInput]);

  const currentWeek = weeks[selWeek];
  const currentDay  = currentWeek?.days[selDay];

  // ── 週統計 ───────────────────────────────────────
  const weekStats = useMemo(() => weeks.map(w => {
    const ms=w.days.map(d=>d.morning).filter(v=>v!=null);
    const ns=w.days.map(d=>d.night).filter(v=>v!=null);
    const cs=w.days.map(d=>d.cal).filter(v=>v!=null);
    return {
      label: w.weekLabel,
      avgMorning: ms.length?(ms.reduce((a,b)=>a+b,0)/ms.length).toFixed(1):"—",
      avgNight:   ns.length?(ns.reduce((a,b)=>a+b,0)/ns.length).toFixed(1):"—",
      avgCal:     cs.length?Math.round(cs.reduce((a,b)=>a+b,0)/cs.length):"—",
    };
  }), [weeks]);

  const chartData = useMemo(() =>
    weeks.flatMap(w=>w.days).map(d=>({ date:d.date, 朝体重:d.morning, 夜体重:d.night, カロリー:d.cal }))
  , [weeks]);

  const mealTotals = useMemo(() => {
    const ms=currentDay?.meals||[];
    return {
      kcal:    ms.reduce((s,m)=>s+(parseFloat(m.kcal)||0),0),
      protein: ms.reduce((s,m)=>s+(parseFloat(m.protein)||0),0),
      fat:     ms.reduce((s,m)=>s+(parseFloat(m.fat)||0),0),
      carb:    ms.reduce((s,m)=>s+(parseFloat(m.carb)||0),0),
    };
  }, [currentDay]);

  // ── ヘルパー ─────────────────────────────────────
  function showPraise(type) {
    setPraiseMsg(getRandom(PRAISE[type]));
    setTimeout(()=>setPraiseMsg(""),4000);
  }

  // updateDay: weeksを更新してlocalStorageにも即書き込む（2段保存）
  const updateDay = useCallback((wi, di, patch) => {
    setWeeks(ws => {
      const next = ws.map((w,i) => i!==wi ? w : {
        ...w, days: w.days.map((d,j) => j!==di ? d : {...d,...patch})
      });
      lsSet(KEYS.weeks, next); // useEffect に加えて即座にも保存
      return next;
    });
  }, []);

  const updateWeek = useCallback((wi, patch) => {
    setWeeks(ws => {
      const next = ws.map((w,i) => i!==wi ? w : {...w,...patch});
      lsSet(KEYS.weeks, next);
      return next;
    });
  }, []);

  // weeksを変更する際も即保存するラッパー
  const setWeeksSafe = useCallback((updater) => {
    setWeeks(prev => {
      const next = typeof updater==="function" ? updater(prev) : updater;
      lsSet(KEYS.weeks, next);
      return next;
    });
  }, []);

  function addMeal() {
    if (!mealForm.time||!mealForm.name) return;
    const meal  = {...mealForm, id:Date.now()};
    const meals = [...(currentDay.meals||[]), meal];
    const cal   = Math.round(meals.reduce((s,m)=>s+(parseFloat(m.kcal)||0),0));
    updateDay(selWeek, selDay, {meals, cal});
    setMealForm({time:"",name:"",kcal:"",protein:"",fat:"",carb:"",photo:null});
    showPraise("meal");
  }
  function removeMeal(id) {
    const meals = (currentDay.meals||[]).filter(m=>m.id!==id);
    updateDay(selWeek, selDay, {meals, cal:Math.round(meals.reduce((s,m)=>s+(parseFloat(m.kcal)||0),0))});
  }
  function handlePhoto(e) {
    const f=e.target.files?.[0]; if(!f) return;
    const r=new FileReader(); r.onload=ev=>setMealForm(fm=>({...fm,photo:ev.target.result})); r.readAsDataURL(f);
  }
  function handleBodyPhoto(e) {
    const f=e.target.files?.[0]; if(!f) return;
    const r=new FileReader(); r.onload=ev=>setBodyPhoto(ev.target.result); r.readAsDataURL(f);
  }

  async function setupReminders() {
    if(!("Notification" in window)){setRemindStatus("このブラウザは通知に対応していません");return;}
    const perm=await Notification.requestPermission();
    if(perm!=="granted"){setRemindStatus("通知が許可されませんでした");return;}
    setRemindStatus("✅ リマインドを設定しました！");
    const sched=(t,title,body)=>{
      const [h,m]=t.split(":").map(Number);
      const now=new Date(),target=new Date();
      target.setHours(h,m,0,0);
      if(target<=now) target.setDate(target.getDate()+1);
      setTimeout(()=>new Notification(title,{body}),target-now);
    };
    sched(remindMorning,"📝 記録の時間です！","今日の記録は済みましたか？日々の記録が目標達成の近道です✨");
    sched(remindNight,  "🌙 お疲れ様でした！","夜の記録を忘れずに✨ 明日も頑張りましょう！");
  }

  // ─── UI ─────────────────────────────────────────
  return (
    <div style={{minHeight:"100vh",background:"#1a1a1a",fontFamily:"'Hiragino Sans','Yu Gothic',sans-serif",color:C.text,paddingBottom:76}}>
      <style>{`
        @keyframes fadeIn{from{opacity:0;transform:translateY(-4px)}to{opacity:1;transform:translateY(0)}}
        * { -webkit-tap-highlight-color:transparent; }
        input[type=number]::-webkit-inner-spin-button{-webkit-appearance:none;}
      `}</style>

      {/* ヘッダー */}
      <div style={{background:"#111",borderBottom:"1px solid rgba(255,255,255,0.07)",padding:"14px 20px",display:"flex",alignItems:"center",justifyContent:"space-between"}}>
        <div style={{display:"flex",alignItems:"center",gap:12}}>
          <div style={{width:36,height:36,borderRadius:10,background:"linear-gradient(135deg,#2e2b28,#3d3a36)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:18,border:"1px solid rgba(255,255,255,0.1)"}}>🔥</div>
          <div>
            <div style={{fontSize:17,fontWeight:800,letterSpacing:"0.08em",color:C.white}}>しぼログ</div>
            <div style={{fontSize:10,color:C.muted}}>シャイニー薊監修 筋トレ・ダイエット記録</div>
          </div>
        </div>
        {/* 保存ステータス表示 */}
        {saveStatus==="saved" && (
          <div style={{fontSize:11,color:C.green,fontWeight:700,padding:"4px 10px",borderRadius:999,background:"rgba(138,170,138,0.15)",border:`1px solid ${C.green}44`,animation:"fadeIn 0.2s ease"}}>✅ 保存済み</div>
        )}
        {saveStatus==="error" && (
          <div style={{fontSize:11,color:C.red,fontWeight:700,padding:"4px 10px",borderRadius:999,background:"rgba(192,128,128,0.15)",border:`1px solid ${C.red}44`}}>⚠️ 保存失敗</div>
        )}
      </div>

      {/* タブバー（固定） */}
      <div style={{position:"fixed",bottom:0,left:0,right:0,background:"#111",borderTop:"1px solid rgba(255,255,255,0.07)",display:"flex",zIndex:100}}>
        {TABS.map((t,i)=>(
          <button key={t} onClick={()=>setTab(t)} style={{flex:1,padding:"10px 2px 8px",border:"none",background:"transparent",cursor:"pointer",display:"flex",flexDirection:"column",alignItems:"center",gap:2,color:tab===t?C.orange:C.muted,borderTop:tab===t?`2px solid ${C.orange}`:"2px solid transparent"}}>
            <span style={{fontSize:16}}>{TICON[i]}</span>
            <span style={{fontSize:9,fontWeight:700}}>{t}</span>
          </button>
        ))}
      </div>

      <div style={{padding:"16px 16px 0"}}>

        {/* ══ ダッシュボード ══ */}
        {tab==="ダッシュボード" && (
          <div style={{display:"flex",flexDirection:"column",gap:14}}>

            {/* 週セレクタ */}
            <div style={{display:"flex",gap:8,overflowX:"auto",paddingBottom:4}}>
              {weeks.map((w,i)=>(
                <button key={w.weekLabel} onClick={()=>{setSelWeekLabel(w.weekLabel);setSelDay(0);}}
                  style={{padding:"6px 14px",borderRadius:999,border:"none",cursor:"pointer",whiteSpace:"nowrap",fontSize:12,fontWeight:700,
                    background:selWeekLabel===w.weekLabel?`linear-gradient(135deg,${C.orange},${C.pink})`:"rgba(255,255,255,0.07)",
                    color:selWeekLabel===w.weekLabel?"#fff":C.muted}}>
                  {w.weekLabel}
                </button>
              ))}
            </div>

            {/* 目標バナー */}
            {(goal.type||goal.targetNum||goal.targetDate)&&(
              <div style={{display:"flex",alignItems:"center",gap:10,padding:"10px 14px",borderRadius:12,background:"linear-gradient(135deg,rgba(255,107,157,0.12),rgba(180,138,255,0.1))",border:`1px solid ${C.pink}44`}}>
                <span style={{fontSize:18}}>🎯</span>
                <div style={{flex:1,fontSize:12,lineHeight:1.6}}>
                  {goal.type&&<span style={{fontWeight:800,color:C.pink,marginRight:6}}>{goal.type}</span>}
                  {goal.targetNum&&<span style={{color:C.text}}>{goal.targetNum}</span>}
                  {goal.targetDate&&<span style={{color:C.muted,marginLeft:6}}>／{goal.targetDate}</span>}
                </div>
                <button onClick={()=>setTab("設定")} style={{fontSize:10,color:C.purple,background:"none",border:"none",cursor:"pointer",fontWeight:700}}>編集 →</button>
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

            {/* 週間カレンダー */}
            <div style={cardSt({cursor:"pointer"})} onClick={()=>setTab("カレンダー")}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:14}}>
                <div style={{fontSize:13,fontWeight:700,color:C.purple}}>📅 週間カレンダー</div>
                <span style={{fontSize:11,color:C.muted}}>タップで月間表示 →</span>
              </div>
              <div style={{display:"grid",gridTemplateColumns:"repeat(7,1fr)",gap:4}}>
                {currentWeek?.days.map((d,i)=>{
                  const parts=(d.training?.parts||"").split(",").filter(Boolean);
                  const hasTrain=d.training?.done;
                  return(
                    <div key={i} style={{background:hasTrain?"rgba(255,107,53,0.12)":"rgba(255,255,255,0.04)",borderRadius:12,border:hasTrain?`1px solid ${C.orange}44`:`1px solid ${C.border}`,padding:"8px 4px",textAlign:"center",minHeight:80,display:"flex",flexDirection:"column",alignItems:"center",gap:2}}>
                      <div style={{fontSize:10,fontWeight:800,color:hasTrain?C.orange:C.muted}}>{d.date.split("/")[1]}</div>
                      <div style={{fontSize:9,color:C.dim}}>{["月","火","水","木","金","土","日"][i]}</div>
                      {d.mood&&<div style={{fontSize:15,lineHeight:1}}>{d.mood}</div>}
                      {parts.slice(0,1).map((p,pi)=>(<div key={pi} style={{fontSize:7,fontWeight:700,background:`${C.orange}22`,color:C.orange,borderRadius:4,padding:"1px 4px",maxWidth:"100%",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{p}</div>))}
                      {!hasTrain&&<div style={{fontSize:9,color:C.dim,marginTop:"auto"}}>休</div>}
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
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)"/>
                  <XAxis dataKey="date" tick={{fill:C.muted,fontSize:9}} interval={2}/>
                  <YAxis domain={["auto","auto"]} tick={{fill:C.muted,fontSize:9}}/>
                  <Tooltip contentStyle={{background:"#1a2535",border:"none",borderRadius:10,fontSize:12}}/>
                  {calc.goalWeight&&<ReferenceLine y={calc.goalWeight} stroke={C.purple} strokeDasharray="4 4" label={{value:`目標 ${calc.goalWeight}kg`,fill:C.purple,fontSize:9,position:"insideTopRight"}}/>}
                  <Line type="monotone" dataKey="朝体重" stroke={C.yellow} strokeWidth={2} dot={{r:2,fill:C.yellow}} connectNulls/>
                  <Line type="monotone" dataKey="夜体重" stroke={C.purple} strokeWidth={2} dot={{r:2,fill:C.purple}} connectNulls/>
                </LineChart>
              </ResponsiveContainer>
              <div style={{display:"flex",gap:16,justifyContent:"center",marginTop:6}}>
                <span style={{fontSize:11,color:C.yellow}}>● 朝体重</span>
                <span style={{fontSize:11,color:C.purple}}>● 夜体重</span>
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
                  {calc.cut&&<ReferenceLine y={calc.cut} stroke={C.orange} strokeDasharray="4 4" label={{value:`目標${calc.cut}`,fill:C.orange,fontSize:9,position:"insideTopRight"}}/>}
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

        {/* ══ 食事 ══ */}
        {tab==="食事" && (
          <div style={{display:"flex",flexDirection:"column",gap:14}}>
            {praiseMsg&&<div style={{padding:"14px 16px",borderRadius:14,background:"linear-gradient(135deg,rgba(255,107,53,0.18),rgba(180,138,255,0.18))",border:`1px solid ${C.orange}55`,fontSize:14,fontWeight:700,lineHeight:1.6,animation:"fadeIn 0.3s ease"}}>{praiseMsg}</div>}

            <div style={{display:"flex",gap:6,overflowX:"auto",paddingBottom:4}}>
              {currentWeek?.days.map((d,i)=>(
                <button key={i} onClick={()=>setSelDay(i)} style={{padding:"6px 12px",borderRadius:999,border:"none",cursor:"pointer",whiteSpace:"nowrap",fontSize:12,fontWeight:700,background:selDay===i?`linear-gradient(135deg,${C.teal},${C.blue})`:"rgba(255,255,255,0.07)",color:selDay===i?"#fff":C.muted}}>{d.date}</button>
              ))}
            </div>

            <div style={cardSt()}>
              <div style={{fontSize:13,fontWeight:700,color:C.yellow,marginBottom:12}}>⚖️ {currentDay?.date} の体重</div>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
                <div>
                  <div style={{fontSize:11,color:C.yellow,marginBottom:5}}>🌅 朝の体重 (kg)</div>
                  <input type="number" step="0.1" placeholder="例: 48.5" value={currentDay?.morning??""} style={inpSt(`${C.yellow}55`)}
                    onChange={e=>{updateDay(selWeek,selDay,{morning:e.target.value?parseFloat(e.target.value):null});if(e.target.value)showPraise("morning");}}/>
                </div>
                <div>
                  <div style={{fontSize:11,color:C.purple,marginBottom:5}}>🌙 夜の体重 (kg)</div>
                  <input type="number" step="0.1" placeholder="例: 49.0" value={currentDay?.night??""} style={inpSt(`${C.purple}55`)}
                    onChange={e=>{updateDay(selWeek,selDay,{night:e.target.value?parseFloat(e.target.value):null});if(e.target.value)showPraise("night");}}/>
                </div>
              </div>
            </div>

            <div style={cardSt({border:`1px solid ${C.pink}44`})}>
              <div style={{fontSize:13,fontWeight:700,color:C.pink,marginBottom:10}}>📸 今日の体型写真</div>
              <input type="file" accept="image/*" ref={bodyPhotoRef} style={{display:"none"}} onChange={handleBodyPhoto}/>
              {bodyPhoto
                ?<div>
                  <img src={bodyPhoto} alt="body" style={{width:"100%",borderRadius:12,maxHeight:300,objectFit:"cover",marginBottom:8}}/>
                  <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}}>
                    <button onClick={()=>bodyPhotoRef.current.click()} style={{padding:"8px",border:`1px solid ${C.border}`,borderRadius:10,background:"rgba(255,255,255,0.04)",color:C.muted,fontSize:12,cursor:"pointer"}}>🔄 変更</button>
                    <button onClick={()=>setBodyPhoto(null)} style={{padding:"8px",border:`1px solid ${C.red}44`,borderRadius:10,background:"rgba(255,95,95,0.06)",color:C.red,fontSize:12,cursor:"pointer"}}>🗑️ 削除</button>
                  </div>
                </div>
                :<button onClick={()=>bodyPhotoRef.current.click()} style={{...btnGrad(C.pink,C.purple),width:"100%",padding:"11px",fontSize:12}}>📷 写真を追加</button>
              }
            </div>

            <div style={cardSt({border:`1px solid ${C.teal}44`})}>
              <div style={{fontSize:13,fontWeight:700,color:C.teal,marginBottom:6}}>🔍 カロリーを調べる</div>
              <a href="https://calorie.slism.jp" target="_blank" rel="noopener noreferrer" style={{display:"block",textDecoration:"none"}}>
                <button style={{...btnGrad(C.teal,C.blue),width:"100%",padding:"12px",fontSize:14,pointerEvents:"none"}}>🌐 カロリーSlismを開く</button>
              </a>
            </div>

            <div style={cardSt()}>
              <div style={{fontSize:13,fontWeight:700,color:C.orange,marginBottom:12}}>➕ 食事を追加</div>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,marginBottom:8}}>
                <div><div style={{fontSize:11,color:C.muted,marginBottom:4}}>時間</div><input type="time" value={mealForm.time} style={inpSt(`${C.orange}55`)} onChange={e=>setMealForm(f=>({...f,time:e.target.value}))}/></div>
                <div><div style={{fontSize:11,color:C.muted,marginBottom:4}}>食事名</div><input type="text" placeholder="例: 鶏むね定食" value={mealForm.name} style={inpSt()} onChange={e=>setMealForm(f=>({...f,name:e.target.value}))}/></div>
              </div>
              <div style={{display:"grid",gridTemplateColumns:"repeat(2,1fr)",gap:8,marginBottom:8}}>
                {[{key:"kcal",lbl:"カロリー (kcal)",color:C.orange},{key:"protein",lbl:"P タンパク質 (g)",color:C.green},{key:"fat",lbl:"F 脂質 (g)",color:C.yellow},{key:"carb",lbl:"C 炭水化物 (g)",color:C.blue}].map(({key,lbl,color})=>(
                  <div key={key}><div style={{fontSize:11,color,marginBottom:4}}>{lbl}</div><input type="number" placeholder="0" value={mealForm[key]} style={inpSt(`${color}44`)} onChange={e=>setMealForm(f=>({...f,[key]:e.target.value}))}/></div>
                ))}
              </div>
              <input type="file" accept="image/*" ref={photoRef} style={{display:"none"}} onChange={handlePhoto}/>
              <div style={{marginBottom:10}}>
                <button onClick={()=>photoRef.current.click()} style={{width:"100%",padding:"9px",border:`1px solid ${C.border}`,borderRadius:10,background:"rgba(255,255,255,0.04)",color:C.muted,fontSize:12,cursor:"pointer"}}>📷 写真を追加</button>
                {mealForm.photo&&<img src={mealForm.photo} alt="food" style={{width:"100%",borderRadius:10,marginTop:8,maxHeight:180,objectFit:"cover"}}/>}
              </div>
              <button onClick={addMeal} style={{...btnGrad(C.orange,C.pink),width:"100%",padding:"12px",fontSize:14}}>＋ この食事を記録する</button>
            </div>

            {currentDay?.meals?.length>0&&(
              <div style={cardSt()}>
                <div style={{fontSize:13,fontWeight:700,color:C.teal,marginBottom:12}}>🍽️ {currentDay.date} の食事記録</div>
                <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:6,marginBottom:10}}>
                  {[{lbl:"合計",val:Math.round(mealTotals.kcal),unit:"kcal",color:C.orange},{lbl:"P",val:fmt1(mealTotals.protein),unit:"g",color:C.green},{lbl:"F",val:fmt1(mealTotals.fat),unit:"g",color:C.yellow},{lbl:"C",val:fmt1(mealTotals.carb),unit:"g",color:C.blue}].map(({lbl,val,unit,color})=>(
                    <div key={lbl} style={{textAlign:"center",background:"rgba(255,255,255,0.05)",borderRadius:10,padding:"8px 4px",border:`1px solid ${color}33`}}>
                      <div style={{fontSize:9,color:C.muted}}>{lbl}</div>
                      <div style={{fontSize:16,fontWeight:800,color}}>{val}</div>
                      <div style={{fontSize:9,color:C.muted}}>{unit}</div>
                    </div>
                  ))}
                </div>
                {[...currentDay.meals].sort((a,b)=>a.time.localeCompare(b.time)).map(m=>(
                  <div key={m.id} style={{padding:"12px 0",borderBottom:`1px solid ${C.border}`}}>
                    <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start"}}>
                      <div>
                        <div style={{fontSize:13,fontWeight:700}}>{m.time} {m.name}</div>
                        <div style={{fontSize:11,color:C.muted,marginTop:3}}>{m.kcal&&`${m.kcal}kcal`}{m.protein&&` P:${m.protein}g`}{m.fat&&` F:${m.fat}g`}{m.carb&&` C:${m.carb}g`}</div>
                      </div>
                      <button onClick={()=>removeMeal(m.id)} style={{background:"rgba(255,95,95,0.15)",border:"none",borderRadius:6,padding:"4px 10px",color:C.red,fontSize:12,cursor:"pointer"}}>削除</button>
                    </div>
                    {m.photo&&<img src={m.photo} alt="" style={{width:"100%",borderRadius:8,marginTop:8,maxHeight:160,objectFit:"cover"}}/>}
                  </div>
                ))}
              </div>
            )}

            <div style={cardSt()}>
              <div style={{fontSize:12,color:C.muted,marginBottom:6}}>💬 本日のメモ</div>
              <textarea value={currentDay?.note??""} placeholder="体調・気づきなど..."
                onChange={e=>updateDay(selWeek,selDay,{note:e.target.value})}
                style={{...inpSt(),height:70,resize:"none"}}/>
            </div>
          </div>
        )}

        {/* ══ トレーニング ══ */}
        {tab==="トレーニング"&&(
          <TrainingTab weeks={weeks} currentWeek={currentWeek} currentDay={currentDay} selWeek={selWeek} selDay={selDay} updateDay={updateDay} showPraise={showPraise} C={C} cardSt={cardSt} inpSt={inpSt} btnGrad={btnGrad} setSelDay={setSelDay}/>
        )}

        {/* ══ 記録 ══ */}
        {tab==="記録"&&(
          <div style={{display:"flex",flexDirection:"column",gap:14}}>
            <div style={{display:"flex",gap:8,overflowX:"auto",paddingBottom:4}}>
              {weeks.map(w=>(
                <button key={w.weekLabel} onClick={()=>setSelWeekLabel(w.weekLabel)}
                  style={{padding:"6px 14px",borderRadius:999,border:"none",cursor:"pointer",whiteSpace:"nowrap",fontSize:12,fontWeight:700,
                    background:selWeekLabel===w.weekLabel?`linear-gradient(135deg,${C.purple},${C.blue})`:"rgba(255,255,255,0.07)",
                    color:selWeekLabel===w.weekLabel?"#fff":C.muted}}>
                  {w.weekLabel}
                </button>
              ))}
            </div>
            <div style={cardSt()}>
              <div style={{fontSize:13,fontWeight:700,color:C.blue,marginBottom:12}}>📋 日々の記録</div>
              {[...currentWeek?.days].reverse().map((d,i)=>{
                const realIdx=currentWeek.days.findIndex(dd=>dd.date===d.date&&dd.fullKey===d.fullKey);
                return(
                  <div key={d.fullKey||d.date} style={{padding:"12px 0",borderBottom:`1px solid ${C.border}`}}>
                    <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:6}}>
                      <div style={{display:"flex",alignItems:"center",gap:8}}>
                        <div style={{fontSize:13,fontWeight:700,color:C.orange}}>{d.date}</div>
                        {d.mood&&<span style={{fontSize:20}}>{d.mood}</span>}
                      </div>
                      <div style={{display:"flex",gap:8,fontSize:12}}>
                        {d.morning!=null&&<span style={{color:C.yellow}}>🌅{d.morning}kg</span>}
                        {d.night!=null&&<span style={{color:C.purple}}>🌙{d.night}kg</span>}
                      </div>
                    </div>
                    <div style={{display:"flex",gap:6,marginBottom:8,flexWrap:"wrap"}}>
                      {["😊","😆","😍","😭","😡","🤤"].map(emoji=>(
                        <button key={emoji} onClick={()=>updateDay(selWeek,realIdx,{mood:d.mood===emoji?"":emoji})}
                          style={{fontSize:20,background:d.mood===emoji?"rgba(255,107,53,0.25)":"rgba(255,255,255,0.06)",border:d.mood===emoji?`1px solid ${C.orange}`:`1px solid ${C.border}`,borderRadius:10,padding:"4px 8px",cursor:"pointer"}}>
                          {emoji}
                        </button>
                      ))}
                    </div>
                    <input type="text" placeholder="備考を入力..." value={d.note||""}
                      onChange={e=>updateDay(selWeek,realIdx,{note:e.target.value})}
                      style={{...inpSt(),fontSize:12}}/>
                  </div>
                );
              })}
            </div>
            <div style={cardSt({border:`1px solid ${C.purple}44`})}>
              <div style={{fontSize:13,fontWeight:700,color:C.purple,marginBottom:12}}>📝 今週の振り返り</div>
              <textarea value={currentWeek?.reflection||""} placeholder="今週を振り返って..."
                onChange={e=>updateWeek(selWeek,{reflection:e.target.value})}
                style={{...inpSt(`${C.purple}55`),height:130,resize:"none"}}/>
            </div>
          </div>
        )}

        {/* ══ カレンダー ══ */}
        {tab==="カレンダー"&&(
          <CalendarTab weeks={weeks} setWeeks={setWeeksSafe} updateDay={updateDay} setTab={setTab} C={C} cardSt={cardSt} inpSt={inpSt} btnGrad={btnGrad} showPraise={showPraise}/>
        )}

        {/* ══ 設定 ══ */}
        {tab==="設定"&&(
          <div style={{display:"flex",flexDirection:"column",gap:14}}>

            {/* 目標設定 */}
            <div style={cardSt({border:`1px solid ${C.pink}55`,background:"linear-gradient(135deg,rgba(255,107,157,0.08),rgba(180,138,255,0.06))"})}>
              <div style={{fontSize:14,fontWeight:800,color:C.pink,marginBottom:14}}>🎯 目標設定</div>
              <div style={{marginBottom:14}}>
                <div style={{fontSize:11,color:C.muted,marginBottom:8,fontWeight:600}}>目標のタイプ</div>
                <div style={{display:"flex",flexWrap:"wrap",gap:8}}>
                  {["ダイエット","筋力アップ","絞る","健康維持","その他"].map(t=>(
                    <button key={t} onClick={()=>setGoal(g=>({...g,type:t}))} style={{padding:"7px 16px",borderRadius:999,border:"none",cursor:"pointer",fontSize:12,fontWeight:700,background:goal.type===t?`linear-gradient(135deg,${C.pink},${C.purple})`:"rgba(255,255,255,0.08)",color:goal.type===t?"#fff":C.muted}}>{t}</button>
                  ))}
                </div>
              </div>
              <div style={{marginBottom:12}}>
                <div style={{fontSize:11,color:C.muted,marginBottom:5,fontWeight:600}}>📊 数値の目標</div>
                <input type="text" placeholder="例：体重45kgにする" value={goal.targetNum} style={inpSt(`${C.pink}44`)} onChange={e=>setGoal(g=>({...g,targetNum:e.target.value}))}/>
              </div>
              <div style={{marginBottom:12}}>
                <div style={{fontSize:11,color:C.muted,marginBottom:5,fontWeight:600}}>✨ 見た目の目標</div>
                <textarea placeholder="例：腹筋を割りたい" value={goal.targetLook} onChange={e=>setGoal(g=>({...g,targetLook:e.target.value}))} style={{...inpSt(`${C.purple}44`),height:64,resize:"none"}}/>
              </div>
              <div style={{marginBottom:12}}>
                <div style={{fontSize:11,color:C.muted,marginBottom:6,fontWeight:600}}>📷 参考画像</div>
                <input type="file" accept="image/*" ref={goalPhotoRef} style={{display:"none"}}
                  onChange={e=>{const f=e.target.files?.[0];if(!f)return;const r=new FileReader();r.onload=ev=>setGoal(g=>({...g,refPhoto:ev.target.result}));r.readAsDataURL(f);}}/>
                {goal.refPhoto
                  ?<div><img src={goal.refPhoto} alt="goal" style={{width:"100%",borderRadius:10,maxHeight:180,objectFit:"cover",marginBottom:8}}/><button onClick={()=>setGoal(g=>({...g,refPhoto:null}))} style={{padding:"7px 16px",border:`1px solid ${C.red}44`,borderRadius:8,background:"rgba(255,95,95,0.07)",color:C.red,fontSize:12,cursor:"pointer"}}>🗑️ 削除</button></div>
                  :<button onClick={()=>goalPhotoRef.current.click()} style={{...btnGrad(C.purple,C.pink),width:"100%",padding:"10px",fontSize:13}}>📷 画像を追加する</button>
                }
              </div>
              <div>
                <div style={{fontSize:11,color:C.muted,marginBottom:5,fontWeight:600}}>📅 いつまでに</div>
                <input type="text" placeholder="例：2025年8月" value={goal.targetDate} style={inpSt(`${C.yellow}44`)} onChange={e=>setGoal(g=>({...g,targetDate:e.target.value}))}/>
              </div>
            </div>

            {/* リマインド */}
            <div style={cardSt({border:`1px solid ${C.teal}44`})}>
              <div style={{fontSize:14,fontWeight:700,color:C.teal,marginBottom:6}}>🔔 リマインド設定</div>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:12}}>
                <div><div style={{fontSize:11,color:C.yellow,marginBottom:5}}>🌅 朝</div><input type="time" value={remindMorning} style={inpSt(`${C.yellow}55`)} onChange={e=>setRemindMorning(e.target.value)}/></div>
                <div><div style={{fontSize:11,color:C.purple,marginBottom:5}}>🌙 夜</div><input type="time" value={remindNight} style={inpSt(`${C.purple}55`)} onChange={e=>setRemindNight(e.target.value)}/></div>
              </div>
              <button onClick={setupReminders} style={{...btnGrad(C.teal,C.blue),width:"100%",padding:"12px",fontSize:14,marginBottom:8}}>🔔 リマインドを設定する</button>
              {remindStatus&&<div style={{fontSize:12,padding:"8px 12px",borderRadius:8,background:remindStatus.startsWith("✅")?"rgba(74,222,128,0.1)":"rgba(255,95,95,0.1)",color:remindStatus.startsWith("✅")?C.green:C.red}}>{remindStatus}</div>}
            </div>

            {/* 基本情報 */}
            <div style={cardSt()}>
              <div style={{fontSize:14,fontWeight:700,color:C.orange,marginBottom:16}}>⚙️ 基本情報</div>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12}}>
                {[{key:"height",lbl:"身長 (cm)",ph:"158"},{key:"weight",lbl:"現在の体重 (kg)",ph:"48.5"},{key:"fatPct",lbl:"体脂肪率 (%)",ph:"22"},{key:"maintenance",lbl:"メンテナンスカロリー (kcal)",ph:"1600"}].map(({key,lbl,ph})=>(
                  <div key={key}>
                    <div style={{fontSize:11,color:C.muted,marginBottom:5}}>{lbl}</div>
                    <input type="number" placeholder={`例: ${ph}`} value={profile[key]} onChange={e=>setProfile(p=>({...p,[key]:e.target.value}))} style={inpSt()}/>
                  </div>
                ))}
              </div>
            </div>

            {/* 基本計算結果（4枚：除脂肪体重・体脂肪量・目標体重・目標までの-kg） */}
            <div style={cardSt()}>
              <div style={{fontSize:14,fontWeight:700,color:C.teal,marginBottom:14}}>📊 基本計算結果</div>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
                <div style={{background:"rgba(255,255,255,0.05)",borderRadius:12,padding:12,border:`1px solid ${C.green}33`}}>
                  <div style={{fontSize:11,color:C.muted,marginBottom:4}}>除脂肪体重</div>
                  <div style={{fontSize:20,fontWeight:800,color:C.green}}>{fmt1(calc.lbm)}<span style={{fontSize:11,color:C.muted,marginLeft:3}}>kg</span></div>
                </div>
                <div style={{background:"rgba(255,255,255,0.05)",borderRadius:12,padding:12,border:`1px solid ${C.red}33`}}>
                  <div style={{fontSize:11,color:C.muted,marginBottom:4}}>体脂肪量</div>
                  <div style={{fontSize:20,fontWeight:800,color:C.red}}>{fmt1(calc.fatKg)}<span style={{fontSize:11,color:C.muted,marginLeft:3}}>kg</span></div>
                </div>
                <div style={{background:"rgba(255,255,255,0.05)",borderRadius:12,padding:12,border:`1px solid ${C.purple}33`}}>
                  <div style={{fontSize:11,color:C.muted,marginBottom:4}}>目標体重</div>
                  <div style={{fontSize:20,fontWeight:800,color:C.purple}}>
                    {fatGoalCalc.goalWeight!=null ? fmt1(fatGoalCalc.goalWeight) : "—"}
                    <span style={{fontSize:11,color:C.muted,marginLeft:3}}>kg</span>
                  </div>
                  {fatGoalCalc.goalWeight==null&&<div style={{fontSize:9,color:C.dim,marginTop:4}}>目標体脂肪率を入力すると計算</div>}
                </div>
                <div style={{background:"rgba(255,255,255,0.05)",borderRadius:12,padding:12,border:`1px solid ${C.gold}33`}}>
                  <div style={{fontSize:11,color:C.muted,marginBottom:4}}>目標までの-kg</div>
                  <div style={{fontSize:20,fontWeight:800,color:C.gold}}>
                    {fatGoalCalc.diffKg!=null ? fmt1(fatGoalCalc.diffKg) : "—"}
                    <span style={{fontSize:11,color:C.muted,marginLeft:3}}>kg</span>
                  </div>
                  {fatGoalCalc.diffKg==null&&<div style={{fontSize:9,color:C.dim,marginTop:4}}>目標体脂肪率を入力すると計算</div>}
                </div>
              </div>
            </div>

            {/* 目標体脂肪率計算カード（新規） */}
            <FatGoalCard
              profile={profile}
              fatGoalInput={fatGoalInput}
              setFatGoalInput={setFatGoalInput}
              fatGoalCalc={fatGoalCalc}
              C={C} cardSt={cardSt} inpSt={inpSt}
              fmt1={fmt1} fmt2={fmt2} fmt0={fmt0} fmtCeil={fmtCeil}
            />

            {/* カロリー目標 */}
            <CalorieGoalCard calc={calc} C={C} cardSt={cardSt} inpSt={inpSt}/>

            {/* データ管理 */}
            <div style={cardSt()}>
              <div style={{fontSize:14,fontWeight:700,color:C.silver,marginBottom:6}}>💾 データ管理</div>
              <div style={{fontSize:12,color:C.muted,marginBottom:14}}>記録はこのブラウザに自動保存されます。ブラウザを閉じても消えません。</div>
              <div style={{padding:"10px 14px",background:"rgba(255,255,255,0.04)",borderRadius:10,marginBottom:14,display:"flex",alignItems:"center",gap:8}}>
                <span>✅</span>
                <span style={{fontSize:12,color:C.teal}}>自動保存 ON — 入力した瞬間に保存されます</span>
              </div>
              <button onClick={()=>{
                if(window.confirm("全てのデータをリセットしますか？この操作は元に戻せません。")){
                  Object.values(KEYS).forEach(k=>localStorage.removeItem(k));
                  window.location.reload();
                }
              }} style={{width:"100%",padding:"11px",border:"1px solid rgba(255,255,255,0.1)",borderRadius:10,background:"transparent",color:C.muted,fontSize:13,cursor:"pointer",fontWeight:600}}>
                🗑️ データをリセットする
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── 目標体脂肪率計算カード ───────────────────────
function FatGoalCard({ profile, fatGoalInput, setFatGoalInput, fatGoalCalc, C, cardSt, inpSt, fmt1, fmt2, fmt0, fmtCeil }) {
  const { errors, fatPerPct, needFatLoss, totalDeficit, days, weeks } = fatGoalCalc || {};
  const hasBase = profile.weight && profile.fatPct;

  return (
    <div style={cardSt({border:`1px solid ${C.gold}44`,background:"linear-gradient(135deg,rgba(201,168,76,0.06),rgba(180,138,255,0.04))"})}>
      <div style={{fontSize:14,fontWeight:800,color:C.gold,marginBottom:4}}>🎯 目標体脂肪率 計算</div>
      <div style={{fontSize:11,color:C.muted,marginBottom:14,lineHeight:1.6}}>
        目標体脂肪率までに必要な脂肪減少量と、必要な総不足カロリー、達成までの目安期間を表示しています。
      </div>
      {errors?.map((e,i)=>(<div key={i} style={{fontSize:12,color:C.red,padding:"8px 12px",borderRadius:8,background:"rgba(192,128,128,0.1)",marginBottom:8,border:`1px solid ${C.red}33`}}>⚠️ {e}</div>))}
      {!hasBase&&(
        <div style={{fontSize:12,color:C.muted,padding:"10px 12px",borderRadius:8,background:"rgba(255,255,255,0.04)",marginBottom:12}}>
          💡 まず「基本情報」に体重・体脂肪率を入力してください
        </div>
      )}
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:12}}>
        <div>
          <div style={{fontSize:11,color:C.gold,marginBottom:5}}>🎯 目標の体脂肪率 (%)</div>
          <input type="number" step="0.1" placeholder="例: 18"
            value={fatGoalInput.targetFatPct} style={inpSt(`${C.gold}55`)}
            onChange={e=>setFatGoalInput(f=>({...f,targetFatPct:e.target.value}))}/>
        </div>
        <div>
          <div style={{fontSize:11,color:C.orange,marginBottom:5}}>📉 1日の平均不足カロリー (kcal)</div>
          <input type="number" placeholder="例: 500"
            value={fatGoalInput.dailyDeficit} style={inpSt(`${C.orange}55`)}
            onChange={e=>setFatGoalInput(f=>({...f,dailyDeficit:e.target.value}))}/>
        </div>
      </div>
      {(!errors||errors.length===0) && hasBase && (
        <div style={{display:"flex",flexDirection:"column",gap:8}}>
          {fatPerPct!=null&&(
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}}>
              <RItem lbl="体脂肪率1%あたりの脂肪量" val={fmt2(fatPerPct)} unit="kg" color={C.teal} C={C}/>
              {needFatLoss!=null
                ?<RItem lbl="必要脂肪減少量" val={fmt2(needFatLoss)} unit="kg" color={C.orange} C={C}/>
                :<div style={{background:"rgba(255,255,255,0.04)",borderRadius:12,padding:"12px 8px",border:`1px solid ${C.border}`,display:"flex",alignItems:"center",justifyContent:"center"}}><span style={{fontSize:11,color:C.muted}}>目標体脂肪率を入力</span></div>
              }
            </div>
          )}
          {totalDeficit!=null&&<RItem lbl="目標までの総不足カロリー" val={fmt0(totalDeficit)} unit="kcal" color={C.purple} C={C} wide/>}
          {needFatLoss!=null&&!fatGoalInput.dailyDeficit&&(
            <div style={{fontSize:12,color:C.muted,padding:"10px 12px",borderRadius:8,background:"rgba(255,255,255,0.04)",border:`1px solid ${C.border}`}}>
              💡 1日の不足カロリーを入力すると期間を計算できます
            </div>
          )}
          {days!=null&&(
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}}>
              <RItem lbl="目標達成までの日数" val={fmtCeil(days)} unit="日" color={C.green} C={C}/>
              <RItem lbl="目標達成までの週数" val={fmt1(weeks)} unit="週" color={C.blue} C={C}/>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
function RItem({ lbl, val, unit, color, C, wide }) {
  return (
    <div style={{background:"rgba(255,255,255,0.05)",borderRadius:12,padding:"12px 10px",border:`1px solid ${color}33`,gridColumn:wide?"1/-1":"auto"}}>
      <div style={{fontSize:10,color:C.muted,marginBottom:4}}>{lbl}</div>
      <div style={{fontSize:20,fontWeight:800,color}}>{val}<span style={{fontSize:11,color:C.muted,marginLeft:3}}>{unit}</span></div>
    </div>
  );
}

// ─── カロリー目標カード ───────────────────────────
function CalorieGoalCard({ calc, C, cardSt, inpSt }) {
  const [cutInput,  setCutInput]  = useState("");
  const [bulkInput, setBulkInput] = useState("");
  const fmt = v => (v==null||isNaN(v)?"—":Math.round(v));
  const maintenance=calc.maintain??null;
  const cutVal =cutInput !==""?parseInt(cutInput) :null;
  const bulkVal=bulkInput!==""?parseInt(bulkInput):null;
  const cutDiff =cutVal !=null&&maintenance!=null?cutVal -maintenance:null;
  const bulkDiff=bulkVal!=null&&maintenance!=null?bulkVal-maintenance:null;
  return (
    <div style={cardSt()}>
      <div style={{fontSize:14,fontWeight:700,color:C.orange,marginBottom:14}}>🎯 カロリー目標</div>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"12px 14px",borderRadius:12,border:`1px solid ${C.teal}44`,marginBottom:10,background:"rgba(255,255,255,0.03)"}}>
        <div><div style={{fontSize:13,fontWeight:700}}>⚖️ 維持（メンテ）</div><div style={{fontSize:11,color:C.muted}}>基本情報から自動計算</div></div>
        <div style={{fontSize:22,fontWeight:800,color:C.teal}}>{fmt(maintenance)}<span style={{fontSize:11,color:C.muted,marginLeft:2}}>kcal</span></div>
      </div>
      <div style={{padding:"12px 14px",borderRadius:12,border:`1px solid ${C.orange}44`,marginBottom:10,background:"rgba(255,255,255,0.03)"}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8}}>
          <div><div style={{fontSize:13,fontWeight:700}}>🔥 減量（カット）</div>{cutDiff!=null&&<div style={{fontSize:11,color:cutDiff<0?C.orange:"#f87171",marginTop:2}}>メンテより {cutDiff>0?"+":""}{cutDiff} kcal</div>}</div>
          {cutVal!=null&&<div style={{fontSize:22,fontWeight:800,color:C.orange}}>{cutVal}<span style={{fontSize:11,color:C.muted,marginLeft:2}}>kcal</span></div>}
        </div>
        <input type="number" placeholder="目標カロリーを入力（例: 1000）" value={cutInput} style={inpSt(`${C.orange}44`)} onChange={e=>setCutInput(e.target.value)}/>
      </div>
      <div style={{padding:"12px 14px",borderRadius:12,border:`1px solid ${C.green}44`,background:"rgba(255,255,255,0.03)"}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8}}>
          <div><div style={{fontSize:13,fontWeight:700}}>💪 増量（バルク）</div>{bulkDiff!=null&&<div style={{fontSize:11,color:bulkDiff>0?C.green:"#f87171",marginTop:2}}>メンテより {bulkDiff>0?"+":""}{bulkDiff} kcal</div>}</div>
          {bulkVal!=null&&<div style={{fontSize:22,fontWeight:800,color:C.green}}>{bulkVal}<span style={{fontSize:11,color:C.muted,marginLeft:2}}>kcal</span></div>}
        </div>
        <input type="number" placeholder="目標カロリーを入力（例: 1800）" value={bulkInput} style={inpSt(`${C.green}44`)} onChange={e=>setBulkInput(e.target.value)}/>
      </div>
    </div>
  );
}

// ─── RM計算 ─────────────────────────────────────
const calcRM = (w,r) => {
  const ww=parseFloat(w), rr=parseFloat(r);
  if(!ww||!rr||isNaN(ww)||isNaN(rr)) return null;
  return Math.round(ww*(1+rr/40)*10)/10;
};

// ─── トレーニングタブ ────────────────────────────
function TrainingTab({ weeks, currentWeek, currentDay, selWeek, selDay, updateDay, showPraise, C, cardSt, inpSt, btnGrad, setSelDay }) {
  const PARTS=["Push","Pull","Leg","胸","背中","肩","腕・二頭","腕・三頭","脚","腹","臀部"];
  const MAX_SETS=5;
  const [exName, setExName] = useState("");
  const [sets,   setSets]   = useState(Array.from({length:MAX_SETS},()=>({reps:"",weight:""})));
  const training  = currentDay?.training||{};
  const exercises = training.exercises||[];
  const filled    = sets.filter(s=>s.reps!==""&&s.weight!=="");

  const prevRecord=useMemo(()=>{
    const cp=(training.parts||"").split(",").filter(Boolean);
    if(!cp.length) return null;
    const all=weeks.flatMap(w=>w.days);
    const cur=currentDay?.fullKey||currentDay?.date||"";
    const prev=all.filter(d=>(d.fullKey||d.date)!==cur&&d.training?.exercises?.length>0)
      .filter(d=>{ const dp=(d.training?.parts||"").split(",").filter(Boolean); return cp.some(p=>dp.includes(p)); });
    return prev.length?prev[prev.length-1]:null;
  },[weeks,currentDay,training.parts]);

  const prevEx=useMemo(()=>{
    if(!exName||!prevRecord) return null;
    return prevRecord.training?.exercises?.find(e=>e.name.includes(exName)||exName.includes(e.name))||null;
  },[exName,prevRecord]);

  function updSet(idx,f,v){setSets(p=>p.map((s,i)=>i===idx?{...s,[f]:v}:s));}
  function addEx(){
    if(!exName||!filled.length) return;
    const sw=filled.map((s,i)=>({setNo:i+1,reps:s.reps,weight:s.weight,rm:calcRM(s.weight,s.reps)}));
    const best=Math.max(...sw.map(s=>s.rm||0));
    updateDay(selWeek,selDay,{training:{...training,exercises:[...exercises,{id:Date.now(),name:exName,sets:sw,bestRM:best}],done:true}});
    setExName(""); setSets(Array.from({length:MAX_SETS},()=>({reps:"",weight:""})));
    showPraise("training");
  }
  function remEx(id){updateDay(selWeek,selDay,{training:{...training,exercises:exercises.filter(e=>e.id!==id)}});}
  function togPart(p){
    const ps=(training.parts||"").split(",").filter(Boolean);
    updateDay(selWeek,selDay,{training:{...training,parts:(ps.includes(p)?ps.filter(x=>x!==p):[...ps,p]).join(",")}});
  }
  const best=exercises.length?exercises.reduce((b,e)=>e.bestRM>b.rm?{name:e.name,rm:e.bestRM}:b,{name:"",rm:0}):null;

  return (
    <div style={{display:"flex",flexDirection:"column",gap:14}}>
      <div style={{display:"flex",gap:6,overflowX:"auto",paddingBottom:4}}>
        {currentWeek?.days.map((d,i)=>(
          <button key={i} onClick={()=>setSelDay(i)} style={{padding:"6px 12px",borderRadius:999,border:"none",cursor:"pointer",whiteSpace:"nowrap",fontSize:12,fontWeight:700,background:selDay===i?`linear-gradient(135deg,${C.orange},${C.pink})`:"rgba(255,255,255,0.07)",color:selDay===i?"#fff":C.muted}}>{d.date}</button>
        ))}
      </div>
      <div style={cardSt()}>
        <div style={{display:"flex",alignItems:"center",gap:12,marginBottom:14}}>
          <div style={{fontSize:13,fontWeight:700,color:C.orange}}>💪 {currentDay?.date}</div>
          <button onClick={()=>{const nd=!training.done;updateDay(selWeek,selDay,{training:{...training,done:nd}});if(nd)showPraise("training");}} style={{marginLeft:"auto",padding:"7px 18px",border:"none",borderRadius:999,cursor:"pointer",fontWeight:700,fontSize:12,background:training.done?`linear-gradient(135deg,${C.green},${C.teal})`:"rgba(255,255,255,0.07)",color:training.done?"#000":C.muted}}>{training.done?"✅ 筋トレあり":"筋トレなし"}</button>
        </div>
        <div style={{marginBottom:14}}>
          <div style={{fontSize:11,color:C.muted,marginBottom:8}}>部位（複数選択可）</div>
          <div style={{display:"flex",flexWrap:"wrap",gap:8}}>
            {PARTS.map(p=>{const a=(training.parts||"").split(",").includes(p);return(<button key={p} onClick={()=>togPart(p)} style={{padding:"6px 13px",border:"none",borderRadius:999,cursor:"pointer",fontSize:12,fontWeight:700,background:a?`linear-gradient(135deg,${C.orange},${C.pink})`:"rgba(255,255,255,0.07)",color:a?"#fff":C.muted}}>{p}</button>);})}
          </div>
        </div>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
          <div><div style={{fontSize:11,color:C.blue,marginBottom:5}}>🏃 有酸素 (分)</div><input type="number" placeholder="0" value={training.cardio||""} style={inpSt(`${C.blue}55`)} onChange={e=>updateDay(selWeek,selDay,{training:{...training,cardio:parseInt(e.target.value)||0}})}/></div>
          <div><div style={{fontSize:11,color:C.red,marginBottom:5}}>🔥 消費kcal</div><input type="number" placeholder="0" value={training.cardioKcal||""} style={inpSt(`${C.red}55`)} onChange={e=>updateDay(selWeek,selDay,{training:{...training,cardioKcal:parseInt(e.target.value)||0}})}/></div>
        </div>
      </div>
      <div style={cardSt({border:`1px solid ${C.orange}44`})}>
        <div style={{fontSize:13,fontWeight:700,color:C.orange,marginBottom:14}}>➕ 種目を追加</div>
        <div style={{marginBottom:14}}><div style={{fontSize:11,color:C.muted,marginBottom:5}}>種目名</div><input type="text" placeholder="例: ベンチプレス" value={exName} style={inpSt()} onChange={e=>setExName(e.target.value)}/></div>
        {prevEx&&(
          <div style={{marginBottom:12,padding:"10px 12px",borderRadius:10,background:"rgba(94,174,255,0.07)",border:`1px solid ${C.blue}33`}}>
            <div style={{fontSize:10,color:C.blue,fontWeight:700,marginBottom:6}}>📖 前回の記録（{prevRecord.date}）</div>
            <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
              {prevEx.sets.map((s,si)=>(<div key={si} style={{fontSize:11,padding:"3px 9px",borderRadius:999,background:`${C.blue}18`,color:C.blue,fontWeight:600}}>Set{s.setNo} {s.weight}kg×{s.reps}回</div>))}
            </div>
          </div>
        )}
        <div style={{display:"grid",gridTemplateColumns:"36px 1fr 1fr 80px",gap:6,marginBottom:6}}>
          <div style={{fontSize:10,color:C.muted,textAlign:"center"}}>SET</div>
          <div style={{fontSize:10,color:C.yellow}}>回数</div>
          <div style={{fontSize:10,color:C.purple}}>重量(kg)</div>
          <div style={{fontSize:10,color:C.orange,textAlign:"center"}}>推定1RM</div>
        </div>
        {sets.map((s,i)=>{const rm=calcRM(s.weight,s.reps);return(
          <div key={i} style={{display:"grid",gridTemplateColumns:"36px 1fr 1fr 80px",gap:6,marginBottom:8,alignItems:"center"}}>
            <div style={{width:30,height:30,borderRadius:"50%",display:"flex",alignItems:"center",justifyContent:"center",fontSize:12,fontWeight:800,background:s.reps&&s.weight?`linear-gradient(135deg,${C.orange},${C.pink})`:"rgba(255,255,255,0.08)",color:s.reps&&s.weight?"#fff":C.muted}}>{i+1}</div>
            <input type="number" placeholder="回数" value={s.reps} style={{...inpSt(`${C.yellow}44`),padding:"9px 10px",fontSize:14}} onChange={e=>updSet(i,"reps",e.target.value)}/>
            <input type="number" placeholder="kg" value={s.weight} style={{...inpSt(`${C.purple}44`),padding:"9px 10px",fontSize:14}} onChange={e=>updSet(i,"weight",e.target.value)}/>
            <div style={{textAlign:"center",padding:"6px 4px",borderRadius:8,background:rm?`${C.orange}18`:"rgba(255,255,255,0.04)",border:rm?`1px solid ${C.orange}44`:`1px solid ${C.border}`}}>
              {rm?<><span style={{fontSize:14,fontWeight:800,color:C.orange}}>{rm}</span><span style={{fontSize:9,color:C.muted}}>kg</span></>:<span style={{fontSize:10,color:C.dim}}>—</span>}
            </div>
          </div>
        );})}
        {filled.length>0&&<div style={{fontSize:12,color:C.teal,marginBottom:10,fontWeight:700}}>✅ {filled.length}セット入力済み</div>}
        <button onClick={addEx} disabled={!exName||!filled.length} style={{...btnGrad(C.orange,C.pink),width:"100%",padding:"13px",fontSize:14,opacity:(!exName||!filled.length)?0.4:1}}>＋ この種目を記録する</button>
      </div>
      {exercises.length>0&&(
        <div style={cardSt()}>
          <div style={{fontSize:14,fontWeight:800,color:C.teal,marginBottom:14}}>📋 {currentDay?.date} のトレーニング記録</div>
          {best&&best.rm>0&&(<div style={{marginBottom:14,padding:"12px 14px",borderRadius:12,background:"linear-gradient(135deg,rgba(255,209,102,0.13),rgba(255,107,53,0.1))",border:`1px solid ${C.yellow}44`}}><div style={{fontSize:10,color:C.yellow,fontWeight:700,marginBottom:2}}>🏆 本日の最高推定1RM</div><div style={{fontSize:18,fontWeight:800,color:C.yellow}}>{best.name}　{best.rm}kg</div></div>)}
          {exercises.map(ex=>(
            <div key={ex.id} style={{marginBottom:12,padding:"14px",background:"rgba(255,255,255,0.04)",borderRadius:14,border:`1px solid ${C.border}`}}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10}}>
                <div style={{fontSize:14,fontWeight:800}}>{ex.name}</div>
                <div style={{display:"flex",gap:8}}>
                  {ex.bestRM>0&&<span style={{fontSize:11,padding:"3px 10px",borderRadius:999,background:`${C.orange}22`,color:C.orange,fontWeight:700}}>MAX {ex.bestRM}kg</span>}
                  <button onClick={()=>remEx(ex.id)} style={{background:"rgba(255,95,95,0.15)",border:"none",borderRadius:6,padding:"3px 8px",color:C.red,fontSize:11,cursor:"pointer"}}>削除</button>
                </div>
              </div>
              {ex.sets.map((s,si)=>(
                <div key={si} style={{display:"grid",gridTemplateColumns:"36px 1fr 1fr 80px",gap:4,marginBottom:4,alignItems:"center"}}>
                  <div style={{width:26,height:26,borderRadius:"50%",display:"flex",alignItems:"center",justifyContent:"center",fontSize:11,fontWeight:800,background:`linear-gradient(135deg,${C.orange}88,${C.pink}88)`,color:"#fff"}}>{s.setNo}</div>
                  <div style={{fontSize:13,fontWeight:700,color:C.yellow}}>{s.reps}回</div>
                  <div style={{fontSize:13,fontWeight:700,color:C.purple}}>{s.weight}kg</div>
                  <div style={{textAlign:"center",fontSize:13,fontWeight:800,color:C.orange}}>{s.rm}kg</div>
                </div>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── カレンダータブ【全記録・過去日付対応】──────────
function CalendarTab({ weeks, setWeeks, updateDay, setTab, C, cardSt, inpSt, btnGrad, showPraise }) {
  const today=new Date();
  const [viewYear,  setViewYear]  = useState(today.getFullYear());
  const [viewMonth, setViewMonth] = useState(today.getMonth());
  const [selected,  setSelected]  = useState(null);
  const [mealForm,  setMealForm]  = useState({time:"",name:"",kcal:"",protein:"",fat:"",carb:""});
  const [section,   setSection]   = useState("weight");

  const MONTH_JP=["1月","2月","3月","4月","5月","6月","7月","8月","9月","10月","11月","12月"];
  const DOW=["月","火","水","木","金","土","日"];
  const MOODS=["😊","😆","😍","😭","😡","🤤"];
  const PARTS=["Push","Pull","Leg","胸","背中","肩","腕・二頭","腕・三頭","脚","腹","臀部"];

  // 全週の日付マップ（fullKey優先）
  const dayMap=useMemo(()=>{
    const map={};
    weeks.forEach(w=>w.days.forEach((d,di)=>{
      const key=d.fullKey||`${d.year||today.getFullYear()}-${d.date}`;
      map[key]={...d,weekIdx:weeks.indexOf(w),dayIdx:di};
    }));
    return map;
  },[weeks]);

  const firstDay=new Date(viewYear,viewMonth,1);
  const lastDay =new Date(viewYear,viewMonth+1,0);
  const startDow=(firstDay.getDay()+6)%7;
  const totalDays=lastDay.getDate();
  const wCnt=Math.ceil((startDow+totalDays)/7);

  function prevMonth(){if(viewMonth===0){setViewYear(y=>y-1);setViewMonth(11);}else setViewMonth(m=>m-1);setSelected(null);}
  function nextMonth(){if(viewMonth===11){setViewYear(y=>y+1);setViewMonth(0);}else setViewMonth(m=>m+1);setSelected(null);}

  function handleSelect(dayNum) {
    const dateObj=new Date(viewYear,viewMonth,dayNum);
    const fk=makeFullKey(dateObj);
    if(selected===fk){setSelected(null);return;}
    setSelected(fk);
    setSection("weight");
    // その日を含む週がなければ作成して保存
    setWeeks(ws=>{
      const next=ensureWeek(ws,dateObj);
      return next;
    });
  }

  // selectedDataをfullKeyで取得（setWeeks後にも反映される）
  const selectedData = selected ? dayMap[selected] : null;

  function calUpd(patch) {
    if(!selectedData) return;
    updateDay(selectedData.weekIdx, selectedData.dayIdx, patch);
  }
  function addMeal() {
    if(!mealForm.time||!mealForm.name||!selectedData) return;
    const meals=[...(selectedData.meals||[]),{...mealForm,id:Date.now()}];
    calUpd({meals, cal:Math.round(meals.reduce((s,m)=>s+(parseFloat(m.kcal)||0),0))});
    setMealForm({time:"",name:"",kcal:"",protein:"",fat:"",carb:""});
  }
  function remMeal(id) {
    if(!selectedData) return;
    const meals=(selectedData.meals||[]).filter(m=>m.id!==id);
    calUpd({meals, cal:Math.round(meals.reduce((s,m)=>s+(parseFloat(m.kcal)||0),0))});
  }
  function togPart(part) {
    if(!selectedData) return;
    const ps=(selectedData.training?.parts||"").split(",").filter(Boolean);
    calUpd({training:{...(selectedData.training||{}),parts:(ps.includes(part)?ps.filter(p=>p!==part):[...ps,part]).join(",")}});
  }

  const SECS=[{id:"weight",l:"⚖️ 体重"},{id:"meal",l:"🍽️ 食事"},{id:"training",l:"💪 筋トレ"},{id:"mood",l:"😊 気分"},{id:"memo",l:"📝 メモ"}];

  return (
    <div style={{display:"flex",flexDirection:"column",gap:14}}>
      <div style={cardSt()}>
        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:14}}>
          <button onClick={prevMonth} style={{background:"rgba(255,255,255,0.08)",border:"none",borderRadius:8,padding:"8px 14px",color:"#f0f4f8",fontSize:18,cursor:"pointer"}}>‹</button>
          <div style={{fontSize:16,fontWeight:800,color:C.purple}}>{viewYear}年 {MONTH_JP[viewMonth]}</div>
          <button onClick={nextMonth} style={{background:"rgba(255,255,255,0.08)",border:"none",borderRadius:8,padding:"8px 14px",color:"#f0f4f8",fontSize:18,cursor:"pointer"}}>›</button>
        </div>
        <div style={{display:"grid",gridTemplateColumns:"repeat(7,1fr)",gap:2,marginBottom:4}}>
          {DOW.map(d=>(<div key={d} style={{textAlign:"center",fontSize:10,fontWeight:700,color:d==="日"?C.red:d==="土"?C.blue:C.muted,padding:"4px 0"}}>{d}</div>))}
        </div>
        <div style={{display:"grid",gridTemplateColumns:"repeat(7,1fr)",gap:2}}>
          {Array.from({length:wCnt*7}).map((_,idx)=>{
            const dn=idx-startDow+1;
            if(dn<1||dn>totalDays) return <div key={idx} style={{minHeight:50}}/>;
            const fk=makeFullKey(new Date(viewYear,viewMonth,dn));
            const d=dayMap[fk];
            const isToday=viewYear===today.getFullYear()&&viewMonth===today.getMonth()&&dn===today.getDate();
            const isSel=selected===fk;
            const hasTrain=d?.training?.done;
            const dow=(startDow+dn-1)%7;
            return(
              <div key={idx} onClick={()=>handleSelect(dn)}
                style={{minHeight:50,borderRadius:10,padding:"4px 3px",cursor:"pointer",textAlign:"center",
                  background:isSel?`linear-gradient(135deg,${C.purple}44,${C.blue}33)`:hasTrain?"rgba(255,107,53,0.1)":"rgba(255,255,255,0.04)",
                  border:isSel?`1.5px solid ${C.purple}`:isToday?`1.5px solid ${C.teal}`:`1px solid rgba(255,255,255,0.09)`,
                  display:"flex",flexDirection:"column",alignItems:"center",gap:1}}>
                <div style={{fontSize:11,fontWeight:800,color:isToday?C.teal:dow===6?C.red:dow===5?C.blue:hasTrain?C.orange:"#f0f4f8"}}>{dn}</div>
                {d?.mood&&<div style={{fontSize:13}}>{d.mood}</div>}
                {d?.morning!=null&&<div style={{fontSize:8,color:C.yellow}}>🌅{d.morning}</div>}
                {d?.training?.done&&<div style={{fontSize:8,color:C.orange}}>💪</div>}
                {d?.meals?.length>0&&<div style={{fontSize:8,color:C.teal}}>🍽️{d.meals.length}</div>}
              </div>
            );
          })}
        </div>
      </div>

      {selected&&(
        <div style={cardSt({border:`1px solid ${C.purple}44`})}>
          <div style={{fontSize:14,fontWeight:800,color:C.purple,marginBottom:12}}>
            📌 {viewYear}年 {selected?.split("-").slice(1).join("/")} の記録
          </div>

          {/* セクション切替 */}
          <div style={{display:"flex",gap:6,overflowX:"auto",paddingBottom:8,marginBottom:14}}>
            {SECS.map(s=>(
              <button key={s.id} onClick={()=>setSection(s.id)}
                style={{padding:"6px 12px",borderRadius:999,border:"none",cursor:"pointer",whiteSpace:"nowrap",fontSize:11,fontWeight:700,
                  background:section===s.id?`linear-gradient(135deg,${C.purple},${C.blue})`:"rgba(255,255,255,0.08)",
                  color:section===s.id?"#fff":C.muted}}>
                {s.l}
              </button>
            ))}
          </div>

          {/* ─ 体重 ─ */}
          {section==="weight"&&(
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
              <div>
                <div style={{fontSize:11,color:C.yellow,marginBottom:5}}>🌅 朝の体重 (kg)</div>
                <input type="number" step="0.1" placeholder="例: 48.5" value={selectedData?.morning??""} style={inpSt(`${C.yellow}55`)}
                  onChange={e=>calUpd({morning:e.target.value?parseFloat(e.target.value):null})}/>
              </div>
              <div>
                <div style={{fontSize:11,color:C.purple,marginBottom:5}}>🌙 夜の体重 (kg)</div>
                <input type="number" step="0.1" placeholder="例: 49.0" value={selectedData?.night??""} style={inpSt(`${C.purple}55`)}
                  onChange={e=>calUpd({night:e.target.value?parseFloat(e.target.value):null})}/>
              </div>
              {(selectedData?.morning!=null||selectedData?.night!=null)&&(
                <div style={{gridColumn:"1/-1",padding:"8px 12px",borderRadius:8,background:"rgba(255,255,255,0.04)",fontSize:12}}>
                  {selectedData?.morning!=null&&<span style={{color:C.yellow,marginRight:12}}>🌅朝：{selectedData.morning}kg</span>}
                  {selectedData?.night!=null&&<span style={{color:C.purple}}>🌙夜：{selectedData.night}kg</span>}
                </div>
              )}
            </div>
          )}

          {/* ─ 食事 ─ */}
          {section==="meal"&&(
            <div style={{display:"flex",flexDirection:"column",gap:10}}>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}}>
                <div><div style={{fontSize:11,color:C.muted,marginBottom:4}}>時間</div><input type="time" value={mealForm.time} style={inpSt(`${C.orange}55`)} onChange={e=>setMealForm(f=>({...f,time:e.target.value}))}/></div>
                <div><div style={{fontSize:11,color:C.muted,marginBottom:4}}>食事名</div><input type="text" placeholder="例: 鶏むね定食" value={mealForm.name} style={inpSt()} onChange={e=>setMealForm(f=>({...f,name:e.target.value}))}/></div>
              </div>
              <div style={{display:"grid",gridTemplateColumns:"repeat(2,1fr)",gap:8}}>
                {[{key:"kcal",lbl:"カロリー(kcal)",c:C.orange},{key:"protein",lbl:"P(g)",c:C.green},{key:"fat",lbl:"F(g)",c:C.yellow},{key:"carb",lbl:"C(g)",c:C.blue}].map(({key,lbl,c})=>(
                  <div key={key}><div style={{fontSize:11,color:c,marginBottom:4}}>{lbl}</div><input type="number" placeholder="0" value={mealForm[key]} style={inpSt(`${c}44`)} onChange={e=>setMealForm(f=>({...f,[key]:e.target.value}))}/></div>
                ))}
              </div>
              <button onClick={addMeal} style={{...btnGrad(C.orange,C.pink),width:"100%",padding:"11px",fontSize:13}}>＋ 食事を追加</button>
              {selectedData?.meals?.length>0&&(
                <div>
                  <div style={{fontSize:11,color:C.muted,marginBottom:6}}>記録済みの食事</div>
                  {selectedData.meals.map(m=>(
                    <div key={m.id} style={{padding:"8px 0",borderBottom:`1px solid ${C.border}`,display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                      <div><div style={{fontSize:12,fontWeight:700}}>{m.time} {m.name}</div><div style={{fontSize:10,color:C.muted}}>{m.kcal&&`${m.kcal}kcal`}{m.protein&&` P:${m.protein}g`}</div></div>
                      <button onClick={()=>remMeal(m.id)} style={{background:"rgba(255,95,95,0.15)",border:"none",borderRadius:6,padding:"3px 8px",color:C.red,fontSize:11,cursor:"pointer"}}>削除</button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* ─ 筋トレ ─ */}
          {section==="training"&&(
            <div style={{display:"flex",flexDirection:"column",gap:10}}>
              <div style={{display:"flex",alignItems:"center",justifyContent:"space-between"}}>
                <div style={{fontSize:12,color:C.muted}}>筋トレの有無</div>
                <button onClick={()=>calUpd({training:{...(selectedData?.training||{}),done:!selectedData?.training?.done}})}
                  style={{padding:"7px 18px",border:"none",borderRadius:999,cursor:"pointer",fontWeight:700,fontSize:12,
                    background:selectedData?.training?.done?`linear-gradient(135deg,${C.green},${C.teal})`:"rgba(255,255,255,0.07)",
                    color:selectedData?.training?.done?"#000":C.muted}}>
                  {selectedData?.training?.done?"✅ 筋トレあり":"筋トレなし"}
                </button>
              </div>
              <div>
                <div style={{fontSize:11,color:C.muted,marginBottom:8}}>部位（複数選択可）</div>
                <div style={{display:"flex",flexWrap:"wrap",gap:8}}>
                  {PARTS.map(p=>{const a=(selectedData?.training?.parts||"").split(",").includes(p);return(<button key={p} onClick={()=>togPart(p)} style={{padding:"6px 12px",border:"none",borderRadius:999,cursor:"pointer",fontSize:11,fontWeight:700,background:a?`linear-gradient(135deg,${C.orange},${C.pink})`:"rgba(255,255,255,0.07)",color:a?"#fff":C.muted}}>{p}</button>);})}
                </div>
              </div>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}}>
                <div><div style={{fontSize:11,color:C.blue,marginBottom:5}}>🏃 有酸素(分)</div><input type="number" placeholder="0" value={selectedData?.training?.cardio||""} style={inpSt(`${C.blue}55`)} onChange={e=>calUpd({training:{...(selectedData?.training||{}),cardio:parseInt(e.target.value)||0}})}/></div>
                <div><div style={{fontSize:11,color:C.red,marginBottom:5}}>🔥 消費kcal</div><input type="number" placeholder="0" value={selectedData?.training?.cardioKcal||""} style={inpSt(`${C.red}55`)} onChange={e=>calUpd({training:{...(selectedData?.training||{}),cardioKcal:parseInt(e.target.value)||0}})}/></div>
              </div>
            </div>
          )}

          {/* ─ 気分 ─ */}
          {section==="mood"&&(
            <div>
              <div style={{fontSize:11,color:C.muted,marginBottom:10}}>今日の気分・表情を選んでください</div>
              <div style={{display:"flex",gap:10,flexWrap:"wrap"}}>
                {MOODS.map(emoji=>(
                  <button key={emoji} onClick={()=>calUpd({mood:selectedData?.mood===emoji?"":emoji})}
                    style={{fontSize:28,background:selectedData?.mood===emoji?"rgba(180,138,255,0.25)":"rgba(255,255,255,0.06)",
                      border:selectedData?.mood===emoji?`2px solid ${C.purple}`:`1px solid rgba(255,255,255,0.09)`,
                      borderRadius:12,padding:"8px 12px",cursor:"pointer",
                      transform:selectedData?.mood===emoji?"scale(1.2)":"scale(1)",transition:"all 0.15s"}}>
                    {emoji}
                  </button>
                ))}
              </div>
              {selectedData?.mood&&<div style={{marginTop:10,fontSize:14,color:C.purple,fontWeight:700}}>選択中: {selectedData.mood}</div>}
            </div>
          )}

          {/* ─ メモ ─ */}
          {section==="memo"&&(
            <div>
              <div style={{fontSize:11,color:C.muted,marginBottom:6}}>📝 この日のメモ・備考</div>
              <textarea value={selectedData?.note||""} placeholder="体調・気づき・予定など..."
                onChange={e=>calUpd({note:e.target.value})}
                style={{...inpSt(),height:100,resize:"none"}}/>
              <div style={{fontSize:11,color:C.muted,marginTop:10,marginBottom:6}}>📌 予定</div>
              <input type="text" placeholder="予定を入力..." value={selectedData?.schedule||""}
                onChange={e=>calUpd({schedule:e.target.value})}
                style={inpSt(`${C.teal}55`)}/>
            </div>
          )}

          {/* サマリー */}
          <div style={{marginTop:14,padding:"10px 12px",background:"rgba(255,255,255,0.04)",borderRadius:10}}>
            <div style={{fontSize:10,color:C.muted,marginBottom:6}}>この日の記録サマリー</div>
            <div style={{display:"flex",gap:10,flexWrap:"wrap",fontSize:12}}>
              {selectedData?.morning!=null&&<span style={{color:C.yellow}}>🌅{selectedData.morning}kg</span>}
              {selectedData?.night!=null&&<span style={{color:C.purple}}>🌙{selectedData.night}kg</span>}
              {selectedData?.meals?.length>0&&<span style={{color:C.orange}}>🍽️{selectedData.meals.length}食</span>}
              {selectedData?.training?.done&&<span style={{color:C.green}}>💪{selectedData.training.parts||"筋トレ"}</span>}
              {selectedData?.mood&&<span>{selectedData.mood}</span>}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
