\
import { useEffect, useState } from 'react';
import { io } from 'socket.io-client';

const PHASES = { LOBBY:'lobby', COLLECTING:'collecting', REVEALED:'revealed', IN_TURNS:'in_turns', ENDED:'ended' };
const WS_URL = process.env.NEXT_PUBLIC_WS_URL || 'http://localhost:4000';

export default function Home(){
  const [screen,setScreen]=useState('entry');
  const [socket,setSocket]=useState(null);
  const [state,setState]=useState(null);
  const [you,setYou]=useState(null);
  const [roomCode,setRoomCode]=useState('');
  const [toast,setToast]=useState(null);

  useEffect(()=>{
    const s = io(WS_URL,{transports:['websocket']});
    setSocket(s);
    s.on('connect',()=>{
      const token = localStorage.getItem('alias_session');
      if (token) {
        s.emit('session:resume',{token},(res)=>{
          if(res?.ok){ setYou(res.you); setState(res.state); setRoomCode(res.roomCode); setScreen('room'); }
        });
      }
    });
    s.on('room:state', st => setState(st));
    s.on('room:penalty', ({playerId,type})=>{
      if(playerId===you) { setToast("⏰ Time's up! Turn passed."); setTimeout(()=>setToast(null),2400); }
    });
    return ()=>{ s.close(); };
  },[]);

  if(screen==='entry') return (
    <Shell>
      <div className="center">
        <h1 className="title">🎭 Alias Name Game</h1>
        <p className="muted">Guess the secret aliases. Protect your own. Outlast everyone.</p>
        <div className="row">
          <button className="btn btn-pink" onClick={()=>setScreen('host')}>▶ Host a Room</button>
          <button className="btn btn-blue" onClick={()=>setScreen('join')}>➕ Join a Room</button>
        </div>
      </div>
      <Style/>
    </Shell>
  );

  if(screen==='host') return (
    <Shell>
      <Back onClick={()=>setScreen('entry')}/>
      <h2>Host a Room</h2>
      <HostForm onCreate={({name,password})=>{
        socket.emit('room:create',{name,password},(res)=>{
          if(!res.ok) return alert(res.error);
          localStorage.setItem('alias_session', res.token);
          setYou(res.you); setState(res.state); setRoomCode(res.roomCode); setScreen('room');
        });
      }}/>
      <Style/>
    </Shell>
  );

  if(screen==='join') return (
    <Shell>
      <Back onClick={()=>setScreen('entry')}/>
      <h2>Join a Room</h2>
      <JoinForm onJoin={({code,name,password})=>{
        socket.emit('room:join',{code:code.toUpperCase(),name,password},(res)=>{
          if(!res.ok) return alert(res.error === 'GAME_ALREADY_STARTED' ? 'This game has already started.' : res.error);
          localStorage.setItem('alias_session', res.token);
          setYou(res.you); setState(res.state); setRoomCode(code.toUpperCase()); setScreen('room');
        });
      }}/>
      <Style/>
    </Shell>
  );

  if(screen==='room' && state){
    const me = state.players.find(p=>p.id===you);
    const isHost = !!me?.isHost;
    const eliminated = !!me?.isEliminated;

    return (
      <Shell>
        <header className="topbar">
          <div>
            <div className="room">Room {state.code}</div>
            <div className="muted small">Players {state.players.length} • Phase {state.phase}</div>
          </div>
          <div className="row">
            <span className="pill">You: {me?.name}</span>
            <button className="btn" onClick={()=>{
              socket.emit('session:leave', ()=>{
                localStorage.removeItem('alias_session');
                setState(null); setYou(null); setRoomCode(''); setScreen('entry');
              });
            }}>Leave Room</button>
          </div>
        </header>

        {toast && <div className="toast" role="status">{toast}</div>}
        {eliminated && <div className="spectator">👀 Spectator Mode</div>}

        {state.phase===PHASES.LOBBY && !eliminated && (
          <div className="card">
            <Players players={state.players}/>
            {isHost && state.players.length>=3 && (
              <button className="btn btn-pink" onClick={()=>socket.emit('room:reveal',{code:state.code},res=>!res.ok&&alert(res.error))}>Start Alias Collection</button>
            )}
          </div>
        )}

        {state.phase===PHASES.COLLECTING && (
          <div className="grid">
            <div className="card">
              {state.aliases[you] ? (
                <div className="muted">✅ Submitted: <b>{state.aliases[you]}</b></div>
              ) : (
                <AliasForm onSubmit={(alias)=>socket.emit('alias:submit',{code:state.code,playerId:you,alias},res=>!res.ok&&alert(res.error))}/>
              )}
              <Submissions players={state.players} aliases={state.aliases}/>
              {isHost && (
                <button className="btn" onClick={()=>socket.emit('room:reveal',{code:state.code},res=>!res.ok&&alert(res.error))}>Reveal Alias Pool</button>
              )}
            </div>
            <div className="card">
              <h4>Quick Rules</h4>
              <ul>
                <li>No duplicate aliases (case/space/punct insensitive).</li>
                <li>Correct: eliminate and go again (less time).</li>
                <li>Wrong/timeout: pass turn. Last standing wins.</li>
              </ul>
            </div>
          </div>
        )}

        {state.phase===PHASES.REVEALED && (
          <div className="grid">
            <div className="card">
              <h4>Alias Pool</h4>
              <div className="tags">{state.aliasPool.map((a,i)=>(<span key={i} className="tag">{a}</span>))}</div>
            </div>
            <div className="card">
              <Players players={state.players} showStatus/>
              {isHost ? (
                <button className="btn btn-pink" onClick={()=>socket.emit('game:startTurns',{code:state.code},res=>!res.ok&&alert(res.error))}>Start Turns</button>
              ) : (
                <div className="muted small">Waiting for host…</div>
              )}
            </div>
          </div>
        )}

        {state.phase===PHASES.IN_TURNS && (
          <TurnUI state={state} you={you} onGuess={(targetId,aliasText)=>
            socket.emit('game:guess',{code:state.code,playerId:you,targetId,aliasText},res=>!res.ok&&alert(res.error))
          }/>
        )}

        {state.phase===PHASES.ENDED && (
          <div className="card center">
            <div className="title">🏆 Winner</div>
            <div>{state.players.find(p=>p.id===state.winnerId)?.name}</div>
          </div>
        )}

        <Style/>
      </Shell>
    );
  }

  return null;
}

function HostForm({onCreate}){
  const [name,setName]=useState('');
  const [password,setPassword]=useState('');
  return (
    <div className="card form">
      <label>Your Name</label>
      <input value={name} onChange={e=>setName(e.target.value)} placeholder="Dino"/>
      <label>Room Password (min 4)</label>
      <input value={password} onChange={e=>setPassword(e.target.value)} placeholder="••••"/>
      <button className="btn btn-pink" onClick={()=>onCreate({name,password})}>Create Room</button>
    </div>
  );
}

function JoinForm({onJoin}){
  const [code,setCode]=useState('');
  const [name,setName]=useState('');
  const [password,setPassword]=useState('');
  return (
    <div className="card form">
      <label>Room Code</label>
      <input value={code} onChange={e=>setCode(e.target.value.toUpperCase())} placeholder="ABCD"/>
      <label>Your Name</label>
      <input value={name} onChange={e=>setName(e.target.value)} placeholder="Princess"/>
      <label>Password</label>
      <input value={password} onChange={e=>setPassword(e.target.value)} placeholder="••••"/>
      <button className="btn btn-blue" onClick={()=>onJoin({code,name,password})}>Join Room</button>
    </div>
  );
}

function Players({players, showStatus}){
  const list = [...players].sort((a,b)=>a.joinedAt-b.joinedAt);
  return (
    <div>
      <h4>Players</h4>
      <div className="grid3">
        {list.map(p=> (
          <div key={p.id} className={`pill ${p.isEliminated?'out':''}`}>
            <span>{p.name}</span> {showStatus && <b>{p.isEliminated?'OUT':'IN'}</b>}
          </div>
        ))}
      </div>
    </div>
  );
}

function Submissions({players, aliases}){
  const list = [...players].sort((a,b)=>a.joinedAt-b.joinedAt);
  return (
    <div className="list">
      {list.map(p=> (
        <div key={p.id} className="row between">
          <span>{p.name}</span>
          <span className={`tag ${aliases[p.id]? 'ok':'muted'}`}>{aliases[p.id]? 'Submitted':'Pending'}</span>
        </div>
      ))}
    </div>
  );
}

function AliasForm({onSubmit}){
  const [alias,setAlias]=useState('');
  return (
    <div className="row">
      <input className="grow" value={alias} onChange={e=>setAlias(e.target.value)} placeholder="Enter your alias"/>
      <button className="btn" onClick={()=>onSubmit(alias)}>Submit</button>
    </div>
  );
}

function TurnUI({state,you,onGuess}){
  const ct = state.currentTurn;
  const isMyTurn = ct?.playerId === you;
  const alive = state.players.filter(p=>!p.isEliminated);
  const targets = alive.filter(p=>p.id!==you);
  const [tgt,setTgt]=useState(null);
  const [alias,setAlias]=useState('');
  useEffect(()=>{ setTgt(null); setAlias(''); },[ct?.playerId]);
  return (
    <div className="grid">
      <div className="card">
        <div className="row between">
          <h4>Your Guess</h4>
          <span className={`pill ${isMyTurn?'go':'wait'}`}>{isMyTurn? 'Your turn':'Waiting…'} • ⏱ {ct?.timer||''}s</span>
        </div>
        <div className="grid3">
          {targets.map(p=> (
            <button key={p.id} className={`btn tile ${tgt===p.id?'active':''}`} onClick={()=>setTgt(p.id)}>{p.name}</button>
          ))}
        </div>
        <div className="tags">
          {state.aliasPool.map((a,i)=>(
            <button key={i} className={`tag ${alias===a?'active':''}`} onClick={()=>setAlias(a)}>{a}</button>
          ))}
        </div>
        <button className="btn btn-pink" disabled={!isMyTurn || !tgt || !alias} onClick={()=>onGuess(tgt,alias)}>Confirm Guess</button>
      </div>
      <div className="card">
        <h4>Alive Players</h4>
        <Players players={state.players} showStatus/>
      </div>
    </div>
  );
}

function Shell({children}){ return (<div className="shell">{children}</div>); }
function Back({onClick}){ return (<button className="link" onClick={onClick}>← Back</button>); }

function Style(){
  return (
    <style jsx global>{`
      *{box-sizing:border-box} body{margin:0;background:linear-gradient(135deg,#2e1065,#1e3a8a,#0f172a);color:#e2e8f0;font-family:ui-sans-serif,system-ui}
      .shell{max-width:1000px;margin:0 auto;padding:24px}
      .title{font-size:40px;font-weight:900;text-shadow:0 3px 10px rgba(0,0,0,.4)}
      .muted{opacity:.85} .small{font-size:12px}
      .row{display:flex;gap:12px;align-items:center} .between{justify-content:space-between}
      .grid{display:grid;grid-template-columns:1fr 1fr;gap:16px}
      .grid3{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px}
      .center{text-align:center;margin-top:8vh}
      .btn{padding:10px 14px;border-radius:14px;border:2px solid #475569;background:#0b1220;color:#e2e8f0;font-weight:700;cursor:pointer}
      .btn:hover{filter:brightness(1.1)} .btn:disabled{opacity:.5;cursor:not-allowed}
      .btn-pink{background:#ec4899;border-color:#ec4899;color:white}
      .btn-blue{background:#3b82f6;border-color:#3b82f6;color:white}
      .tile{background:#0f172a;border-color:#334155} .tile.active{outline:3px solid #60a5fa}
      .link{color:#fbbf24;text-decoration:underline;text-underline-offset:4px;background:transparent;border:none}
      input{padding:10px 12px;border-radius:12px;border:2px solid #334155;background:#0f172a;color:#e2e8f0;width:100%}
      label{font-size:14px;margin-top:8px;margin-bottom:4px;display:block}
      .form{max-width:460px}
      .card{padding:16px;border-radius:16px;border:2px solid #475569;background:rgba(2,6,23,.7);backdrop-filter:blur(6px);margin:12px 0}
      .tags{display:flex;flex-wrap:wrap;gap:8px}
      .tag{padding:6px 10px;border-radius:999px;border:2px solid #475569;background:#0b1220}
      .tag.ok{background:#064e3b;border-color:#10b981;color:#d1fae5}
      .tag.active{outline:3px solid #fbbf24}
      .pill{padding:6px 10px;border-radius:999px;border:1px solid rgba(255,255,255,.2);background:rgba(255,255,255,.06)}
      .pill.go{background:#064e3b;color:#d1fae5;border-color:#10b981}
      .pill.wait{background:#1f2937;color:#e5e7eb;border-color:#64748b}
      .pill.out{background:#7f1d1d;color:#fecaca;border-color:#ef4444}
      .topbar{display:flex;justify-content:space-between;align-items:center;margin-bottom:10px}
      .room{font-weight:800;font-size:20px}
      .toast{position:fixed;left:50%;top:12px;transform:translateX(-50%);background:#111827;color:#fde68a;border:2px solid #f59e0b;padding:10px 14px;border-radius:14px;z-index:50}
      .spectator{position:fixed;left:50%;top:56px;transform:translateX(-50%);background:#facc15;color:#1f2937;padding:6px 12px;border-radius:999px;font-weight:800}
    `}</style>
  );
}
