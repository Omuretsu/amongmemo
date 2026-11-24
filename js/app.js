(() => {
  const STORAGE_KEY = 'among-memo-v1';
  const REQUIRED_API_VERSION = 2;
  const $ = selector => document.querySelector(selector);
  const esc = value => String(value || '').replace(/[&<>"']/g, character => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[character]));
  let state = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null') || { members: [], session:null, lastRoster:null, lastRules:'', game: { me:'', role:'', rules:'', host:'', participants:[], turn:1, path:[], seen:'', note:'', timeline:[], sabotages:[], deaths:[] } };
  const game = () => state.game;
  let selfPlayer = null;
  let apiToken = '';
  let apiVersion = 0;
  let serverConnected = false;
  let rosterMode = 'first';
  let pendingRoster = null;
  let pendingMeeting = {type:'button',reporter:'',killOccurred:null,victims:[],victimsConfirmed:false,repairs:[],activeRepairIndex:-1,repairDraft:[]};

  if (!Object.hasOwn(state,'session')) {
    const hasProgress=game().turn>1 || game().path.length || game().timeline.length || game().sabotages.length || game().deaths.length;
    state.session=hasProgress ? {id:createId('session'),startedAt:new Date().toISOString(),gameNumber:game().gameNumber||1,awaitingNext:false} : null;
  }
  if (!Object.hasOwn(state,'lastRoster')) state.lastRoster=null;
  if (!Object.hasOwn(state,'lastRules')) state.lastRules=game().rules||'';
  if (!Object.hasOwn(state,'shortcutsEnabled')) state.shortcutsEnabled=true;
  if (!Object.hasOwn(game(),'rules')) game().rules='';

  function ensureSelfPlayer() {
    if (!selfPlayer) return;
    const member=state.members.find(player=>player.id===selfPlayer.id);
    if (member) member.name=selfPlayer.name;
    else state.members.unshift({...selfPlayer});
    const participant=game().participants.find(player=>player.id===selfPlayer.id);
    if (participant) {
      participant.name=selfPlayer.name;
      participant.active=true;
    } else {
      game().participants.unshift({...selfPlayer,active:true,status:'alive'});
    }
    game().me=selfPlayer.id;
  }

  function updateServerStatus(status,message) {
    const element=$('#serverStatus');
    element.textContent=message;
    element.classList.toggle('online',status==='online');
    element.classList.toggle('offline',status==='offline');
  }

  async function apiRequest(path,options={}) {
    const headers={...(options.headers||{})};
    if (options.method && options.method!=='GET') {
      headers['Content-Type']='application/json';
      headers['X-Among-Memo-Token']=apiToken;
    }
    const response=await fetch(path,{...options,headers});
    const data=await response.json().catch(()=>({error:'サーバーから不正な応答がありました'}));
    if (!response.ok) throw Object.assign(new Error(data.error||'サーバーエラーが発生しました'),{status:response.status,data});
    return data;
  }

  function mergeServerPlayer(source) {
    const member={id:String(source.id),name:String(source.name)};
    const existing=state.members.find(player=>player.id===member.id);
    if (existing) existing.name=member.name;
    else state.members.push(member);
    const participant=game().participants.find(player=>player.id===member.id);
    if (participant) participant.name=member.name;
  }

  function save(message='自動保存済み') {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    $('#saveStatus').textContent = message;
    clearTimeout(save.timer);
    save.timer = setTimeout(() => $('#saveStatus').textContent='自動保存済み', 1300);
  }

  function toast(message) {
    const element = $('#toast');
    element.textContent = message;
    element.classList.add('show');
    setTimeout(() => element.classList.remove('show'), 1800);
  }

  function ensureParticipantNumbers() {
    game().participants.forEach((player,index) => { player.meetingNumber=index+1; });
  }

  function activePlayers() {
    ensureParticipantNumbers();
    return game().participants.filter(player => player.active);
  }

  function playerOptions(selected='', includeEmpty=true) {
    return `${includeEmpty ? '<option value="">選択…</option>' : ''}${activePlayers().map(player => `<option value="${esc(player.id)}" ${player.id===selected?'selected':''}>${esc(player.name)}</option>`).join('')}`;
  }

  function playerName(id) {
    return activePlayers().find(player => player.id===id)?.name || state.members.find(player => player.id===id)?.name || '—';
  }

  function meetingVictimIds(meeting) {
    if (Array.isArray(meeting.victims) && meeting.victims.length) return meeting.victims.filter(Boolean);
    return meeting.victim ? [meeting.victim] : [];
  }

  function meetingButtonUserIds() {
    return new Set(game().timeline
      .filter(item => item.kind==='meeting' && item.type==='button' && item.reporter)
      .map(item => item.reporter));
  }

  function meetingRepairText(meeting) {
    return (meeting.repairs||[])
      .filter(repair=>repair.repairers?.length)
      .map(repair=>`${normalizeSabotageType(repair.type)}：${repair.repairers.map(playerName).join('、')}`)
      .join(' ／ ');
  }

  function sabotageRepairerIds(sabotage) {
    if (!sabotage) return [];
    if (Array.isArray(sabotage.repairers)) return [...new Set(sabotage.repairers.filter(Boolean))];
    if (sabotage.action!=='occurred' && sabotage.fixer && sabotage.fixer!==OTHER_FIXER) return [sabotage.fixer];
    return [];
  }

  function repairerIconSets() {
    const blackout=new Set(), communications=new Set();
    for (const sabotage of game().sabotages) {
      if (sabotage.action==='occurred') continue;
      const type=normalizeSabotageType(sabotage.type);
      const target=type==='停電' ? blackout : type==='コミュニケーション' ? communications : null;
      if (target) sabotageRepairerIds(sabotage).forEach(id=>target.add(id));
    }
    return {blackout,communications};
  }

  function render() {
    const buttonUsers=meetingButtonUserIds();
    const repairerIcons=repairerIconSets();
    $('#meName').textContent = selfPlayer?.name || playerName(game().me);
    $('#roleName').textContent = game().role || '未設定';
    $('#rulesSummary').textContent = game().rules || '未設定';
    $('#turnLabel').textContent = `T${game().turn}`;
    $('#sessionLabel').textContent = state.session ? `ゲーム ${state.session.gameNumber}` : '未開始';
    $('#newGame').disabled = Boolean(state.session && !state.session.awaitingNext);
    $('#newGame').textContent = state.session?.awaitingNext ? '次の参加者を選択' : state.session ? 'ゲーム進行中' : '参加者を選択';
    $('#endGame').disabled = !state.session || Boolean(state.session.awaitingNext);
    $('#shortcutToggle').textContent = `ショートカット ${state.shortcutsEnabled?'ON':'OFF'}`;
    $('#shortcutToggle').setAttribute('aria-pressed',String(state.shortcutsEnabled));
    $('#shortcutToggle').classList.toggle('enabled',state.shortcutsEnabled);
    $('#players').innerHTML = activePlayers().length
      ? activePlayers().map(player => `<div class="player"><span>${esc(player.name)}${buttonUsers.has(player.id)?' <span class="meeting-button-used" title="会議ボタン使用済み" aria-label="会議ボタン使用済み">🛎️</span>':''}${repairerIcons.blackout.has(player.id)?' <span class="repairer-mark" title="停電の修理者" aria-label="停電の修理者">⚡️</span>':''}${repairerIcons.communications.has(player.id)?' <span class="repairer-mark" title="コミュニケーションの修理者" aria-label="コミュニケーションの修理者">📡</span>':''}${player.id===game().host?' <span class="pill">ホスト</span>':''}</span><select data-status="${esc(player.id)}"><option value="alive" ${player.status==='alive'?'selected':''}>生存</option><option value="dead" ${player.status==='dead'?'selected':''}>死亡</option><option value="ejected" ${player.status==='ejected'?'selected':''}>追放</option></select></div>`).join('')
      : '<p class="empty">メンバー管理から参加者を登録してください。</p>';
    $('#path').innerHTML = game().path.length
      ? game().path.map((room,index) => `<span class="room ${isSabotagePathLabel(room)?'repair':''}">${esc(room)} <button data-remove-path="${index}" title="削除">×</button></span>`).join(' → ')
      : '<span class="meta">移動先を追加</span>';
    $('#seen').value = game().seen;
    $('#turnNote').value = game().note;
    $('#timeline').innerHTML = game().timeline.length
      ? [...game().timeline].reverse().map(item => item.kind==='turn'
        ? `<article class="card"><h3>T${item.turn} <span class="pill">行動</span></h3><div class="detail"><b>経路：</b>${esc(item.path.join(' → ') || '—')}<br><b>視認：</b>${esc(item.seen || '—')}<br><b>メモ：</b>${esc(item.note || '—')}</div></article>`
        : `<article class="card meeting"><h3>会議 ${item.type==='button'?'緊急ボタン':'死体通報'} <span class="pill">T${item.turn}</span></h3><div class="detail"><b>起票：</b>${esc(playerName(item.reporter))}${meetingVictimIds(item).length?`　<b>死亡：</b>${meetingVictimIds(item).map(playerName).map(esc).join('、')} @ ${esc(item.bodyPlace||'不明')}`:''}<br><b>視認：</b>${esc(item.witness||'—')}${meetingRepairText(item)?`<br><b>妨害修理：</b>${esc(meetingRepairText(item))}`:''}<br><b>結果：</b>${esc(item.result||'—')}<br><b>メモ：</b>${esc(item.note||'—')}</div>${item.alibis?.length?`<div class="tags">${item.alibis.map(alibi=>`<span class="tag">${esc(playerName(alibi.player))}：${esc(alibi.reason||'白根拠')}</span>`).join('')}</div>`:''}</article>`).join('')
      : '<p class="empty">まだ記録はありません。</p>';
    $('#saboLog').innerHTML = game().sabotages.length
      ? [...game().sabotages].reverse().map(sabotage => {
        const repairers=sabotageRepairerIds(sabotage);
        const repairerLabel=repairers.length ? repairers.map(playerName).join('、') : sabotage.fixer===OTHER_FIXER ? '他者（未特定）' : playerName(sabotage.fixer);
        return `<article class="card"><h3>T${sabotage.turn} ${esc(normalizeSabotageType(sabotage.type))}</h3><div class="detail">${sabotage.action==='occurred'?'<b>状態：</b>発生':`<b>修理：</b>${esc(repairerLabel)}`}${sabotage.place?` @ ${esc(sabotage.place)}`:''}${sabotage.note?`<br>${esc(sabotage.note)}`:''}</div></article>`;
      }).join('')
      : '<p class="empty">妨害の記録はありません。</p>';
    $('#deathBoard').innerHTML = game().deaths.length
      ? [...game().deaths].reverse().map(death => `<article class="card meeting"><h3>${esc(playerName(death.victim))} <span class="dead">死亡</span> <small>T${death.turn}</small></h3><div class="detail"><b>発見：</b>${esc(playerName(death.reporter))} @ ${esc(death.bodyPlace||'不明')}<br><b>視認：</b>${esc(death.witness||'—')}</div>${death.alibis?.length?`<div class="tags">${death.alibis.map(alibi=>`<span class="tag">キル不可：${esc(playerName(alibi.player))}<br>${esc(alibi.reason||'理由未記入')}</span>`).join('')}</div>`:'<div class="meta">キル不可能者は未記録</div>'}</article>`).join('')
      : '<p class="empty">死亡情報はありません。</p>';
  }

  function commitTurn() {
    const hasContent = game().path.length || game().seen || game().note;
    if (!hasContent) return false;
    game().timeline.push({kind:'turn',turn:game().turn,path:[...game().path],seen:game().seen,note:game().note});
    game().path=[];
    game().seen='';
    game().note='';
    return true;
  }

  function nextTurn() {
    commitTurn();
    game().turn++;
    save();
    render();
    toast(`T${game().turn} を開始しました`);
  }

  function openDialog(selector) { $(selector).showModal(); }

  const meetingShortcutLabel = number => number<=9 ? String(number) : number===10 ? '0' : `⇧${number-10}`;
  const unavailableVictim = player => player.status==='dead' || player.status==='ejected';
  const meetingReporterBlockReason = player => {
    if (pendingMeeting.type!=='button') return '';
    if (meetingButtonUserIds().has(player.id)) return 'すでに会議ボタンを使用しています';
    if (player.status==='dead') return '死亡済みのプレイヤーは会議ボタンを使えません';
    if (player.status==='ejected') return '追放済みのプレイヤーは会議ボタンを使えません';
    return '';
  };
  const meetingPersonButton = (player,kind) => {
    const reporterBlocked=kind==='reporter' ? meetingReporterBlockReason(player) : '';
    const repairerBlocked=kind==='repairer' && player.id===game().me;
    const unavailable=kind==='victim' ? unavailableVictim(player) : kind==='repairer' ? repairerBlocked : Boolean(reporterBlocked);
    const selected=kind==='victim' ? pendingMeeting.victims.includes(player.id) : kind==='repairer' ? pendingMeeting.repairDraft.includes(player.id) : false;
    const dataAttribute=kind==='victim'?'data-meeting-victim':kind==='repairer'?'data-meeting-repairer':'data-meeting-reporter';
    const status=player.status==='dead'?'死亡':player.status==='ejected'?'追放':'';
    const usedButton=kind==='reporter' && meetingButtonUserIds().has(player.id);
    const blockedReason=reporterBlocked || (repairerBlocked?'自分以外の修理者を選択してください':'');
    return `<button type="button" class="meeting-person${selected?' selected':''}" ${dataAttribute}="${esc(player.id)}" ${kind==='victim'||kind==='repairer'?`aria-pressed="${selected}"`:''} ${unavailable?'disabled aria-disabled="true"':''} ${blockedReason?`title="${esc(blockedReason)}"`:''}><span class="meeting-player-number">${player.meetingNumber}</span><span class="meeting-player-name">${esc(player.name)}${usedButton?' <span class="meeting-button-used" aria-label="会議ボタン使用済み">🛎️</span>':''}${status?` <span class="meeting-player-status">${status}</span>`:''}</span><kbd class="meeting-key">${meetingShortcutLabel(player.meetingNumber)}</kbd></button>`;
  };

  function renderMeetingVictimList() {
    const players=activePlayers().slice(0,13);
    $('#meetingVictimList').innerHTML = [...players].sort((left,right)=>Number(unavailableVictim(left))-Number(unavailableVictim(right)) || left.meetingNumber-right.meetingNumber).map(player=>meetingPersonButton(player,'victim')).join('');
    $('#meetingVictimCount').textContent=`${pendingMeeting.victims.length}名を選択中`;
  }

  function activeMeetingRepair() {
    return pendingMeeting.repairs[pendingMeeting.activeRepairIndex] || null;
  }

  function renderMeetingRepairSummary() {
    const hasRepairs=pendingMeeting.repairs.length>0;
    $('#meetingRepairSummary').classList.toggle('hidden',!hasRepairs);
    $('#meetingRepairRecords').innerHTML=pendingMeeting.repairs.map((repair,index)=>{
      const icon=repair.type==='停電'?'⚡️':'📡';
      const prompt=repair.mode==='self'?'自分以外に直した人':'直した人';
      let result='未入力';
      if (repair.confirmed) result=repair.selected.length ? repair.selected.map(playerName).join('、') : '自分のみ';
      return `<div class="meeting-repair-record"><div><b>${icon} ${esc(repair.type)}：${prompt}</b><div class="repair-result${repair.confirmed?' recorded':''}">${esc(result)}</div></div><button type="button" class="secondary small" data-meeting-repair-index="${index}">${repair.confirmed?'変更':'入力'}</button></div>`;
    }).join('');
  }

  function renderMeetingRepairerList() {
    const repair=activeMeetingRepair();
    if (!repair) return;
    const icon=repair.type==='停電'?'⚡️':'📡';
    const question=repair.mode==='self'?'自分の他に誰が':'誰が';
    $('#meetingRepairerTitle').textContent=`${icon} ${repair.type}を${question}直しましたか？`;
    $('#meetingRepairerHelp').textContent='参加者を押すか、表示されているキーで複数選択し、⌘Enterで確定してください。自分は選択対象外です。';
    $('#meetingRepairerList').innerHTML=activePlayers().slice(0,13).map(player=>meetingPersonButton(player,'repairer')).join('');
    $('#meetingRepairerCount').textContent=`${pendingMeeting.repairDraft.length}名を選択中`;
  }

  function fillMeeting() {
    $('#alibiPeople').innerHTML = activePlayers().filter(player => player.status==='alive').map(player => `<label><input type="checkbox" value="${esc(player.id)}">${esc(player.name)}</label>`).join('');
    const players=activePlayers().slice(0,13);
    const reporters=pendingMeeting.type==='button' ? [...players].sort((left,right)=>Number(unavailableVictim(left))-Number(unavailableVictim(right)) || left.meetingNumber-right.meetingNumber) : players;
    $('#meetingReporterList').innerHTML = reporters.map(player=>meetingPersonButton(player,'reporter')).join('');
    renderMeetingVictimList();
    renderMeetingRepairSummary();
  }

  function createId(name) { return `${Date.now()}-${Math.random().toString(36).slice(2,7)}-${name}`; }
  function createGameState(selectedIds=[],host='',gameNumber=1,sessionId='') {
    const selected=new Set(selectedIds);
    if (selfPlayer) selected.add(selfPlayer.id);
    const participants=state.members.filter(member=>selected.has(member.id)).map((member,index)=>({...member,active:true,status:'alive',meetingNumber:index+1}));
    return {id:createId('game'),sessionId,gameNumber,me:selfPlayer?.id||'',role:'',rules:'',host,participants,turn:1,path:[],seen:'',note:'',timeline:[],sabotages:[],deaths:[]};
  }
  const keyLabel = key => key && key===key.toUpperCase() ? `⇧${key.toLowerCase()}` : key;
  const roomScale = (value, maximum) => value / maximum * (100 - AIRSHIP_MAP_PADDING * 2);

  $('#roomButtons').innerHTML = AIRSHIP_ROOMS.map(([room,key,x,y,width,height]) => `<button class="map-room" style="left:${AIRSHIP_MAP_PADDING+roomScale(x,AIRSHIP_MAP_WIDTH)}%;top:${AIRSHIP_MAP_PADDING+roomScale(y,AIRSHIP_MAP_HEIGHT)}%;width:${roomScale(width,AIRSHIP_MAP_WIDTH)}%;height:${roomScale(height,AIRSHIP_MAP_HEIGHT)}%" data-room="${esc(room)}" title="短縮キー：${keyLabel(key)}"><span class="room-name">${esc(room)}</span> <span class="map-key">${keyLabel(key)}</span></button>`).join('');

  const SABOTAGE_SHORTCUTS = {'Digit1':'停電','Digit2':'コミュニケーション','Digit3':'リアクター'};
  const OTHER_FIXER = '__other__';
  const normalizeSabotageType = type => ({'通信':'コミュニケーション','原子炉':'リアクター'}[type] || type);
  const sabotagePathLabel = (type,action,fixer='') => {
    const normalized=normalizeSabotageType(type);
    if (action==='occurred') return `⚠ ${normalized}が発生`;
    if (fixer===OTHER_FIXER) return `⚡ ${normalized}を他者が修理`;
    return `⚡ ${normalized}を修理`;
  };
  const isSabotagePathLabel = label => label.startsWith('⚡') || label.startsWith('⚠');
  const sabotageRecordLabel = sabotage => sabotagePathLabel(sabotage.type,sabotage.action||'repaired',sabotage.fixer);

  function removePathAt(index) {
    const removed = game().path.splice(index,1)[0];
    if (!isSabotagePathLabel(removed)) return;
    for (let index=game().sabotages.length-1; index>=0; index--) {
      const sabotage = game().sabotages[index];
      if (sabotage.turn===game().turn && sabotageRecordLabel(sabotage)===removed) {
        game().sabotages.splice(index,1);
        break;
      }
    }
  }

  function recordSabotage(type,{action='repaired',fixer='',place='',note='',addToPath=false}={}) {
    const normalized=normalizeSabotageType(type);
    const repairers=action==='occurred' || !fixer || fixer===OTHER_FIXER ? [] : [fixer];
    game().sabotages.push({turn:game().turn,type:normalized,action,fixer,repairers,place,note});
    if (addToPath) game().path.push(sabotagePathLabel(normalized,action,fixer));
  }

  function meetingRepairCandidatesFromCurrentPath() {
    const remainingPath=[...game().path];
    return game().sabotages.map((sabotage,sabotageIndex)=>({sabotage,sabotageIndex})).reduce((repairs,{sabotage,sabotageIndex})=>{
      const type=normalizeSabotageType(sabotage.type);
      if (sabotage.turn!==game().turn || sabotage.action==='occurred' || !['停電','コミュニケーション'].includes(type)) return repairs;
      const pathIndex=remainingPath.indexOf(sabotageRecordLabel(sabotage));
      if (pathIndex===-1) return repairs;
      remainingPath.splice(pathIndex,1);
      const mode=sabotage.fixer===game().me?'self':'other';
      const selected=sabotageRepairerIds(sabotage).filter(id=>id!==game().me);
      repairs.push({sabotageIndex,type,mode,selected,confirmed:selected.length>0});
      return repairs;
    },[]);
  }

  document.addEventListener('click', event => {
    const meetingReporter = event.target.closest('[data-meeting-reporter]');
    if (meetingReporter) {
      selectMeetingReporter(meetingReporter.dataset.meetingReporter);
      return;
    }
    const meetingKill = event.target.closest('[data-meeting-kill]');
    if (meetingKill) {
      selectMeetingKillOccurred(meetingKill.dataset.meetingKill==='yes');
      return;
    }
    const meetingVictim = event.target.closest('[data-meeting-victim]');
    if (meetingVictim && !meetingVictim.disabled) {
      selectMeetingVictim(meetingVictim.dataset.meetingVictim);
      return;
    }
    const meetingRepairer = event.target.closest('[data-meeting-repairer]');
    if (meetingRepairer && !meetingRepairer.disabled) {
      selectMeetingRepairer(meetingRepairer.dataset.meetingRepairer);
      return;
    }
    const meetingRepair = event.target.closest('[data-meeting-repair-index]');
    if (meetingRepair) {
      showMeetingRepairerStep(Number(meetingRepair.dataset.meetingRepairIndex));
      return;
    }
    const room = event.target.closest('[data-room]');
    if (room) {
      game().path.push(room.dataset.room);
      save();
      render();
      return;
    }
    const remove = event.target.closest('[data-remove-path]');
    if (remove) {
      removePathAt(+remove.dataset.removePath);
      save();
      render();
      return;
    }
    const status = event.target.closest('[data-status]');
    if (status && event.target.tagName==='SELECT') {
      activePlayers().find(player => player.id===status.dataset.status).status=event.target.value;
      save();
      render();
    }
  });

  function quickSabotage(type,mode='self') {
    if (!state.session) return toast('先に参加者を確定してゲームを開始してください');
    const action=mode==='occurred'?'occurred':'repaired';
    const fixer=mode==='self'?game().me:mode==='other'?OTHER_FIXER:'';
    recordSabotage(type,{action,fixer,note:'ショートカット記録',addToPath:true});
    save();
    render();
    const message=mode==='occurred'?`${type}の発生`:mode==='other'?`${type}を他者が修理`:`${type}を修理`;
    toast(`${message}を経路に追加しました`);
  }

  const meetingButtonLabels = {
    self:'🔔 自分が会議ボタンを押下',
    other:'🔔 他者が会議ボタンを押下'
  };
  const bodyReportLabels = {
    self:'📣 自分が死体を通報',
    other:'📣 他者が死体を通報'
  };

  function hasUsedOwnMeetingButton() {
    if (game().path.includes(meetingButtonLabels.self)) return true;
    return game().timeline.some(item =>
      (item.kind==='turn' && item.path?.includes(meetingButtonLabels.self)) ||
      (item.kind==='meeting' && item.type==='button' && item.reporter===game().me)
    );
  }

  function quickMeetingEvent(kind,actor='self') {
    if (!state.session) return toast('先に参加者を確定してゲームを開始してください');
    if (kind==='button' && actor==='self' && hasUsedOwnMeetingButton()) {
      return toast('自分の会議ボタンはすでに使用済みです');
    }
    const labels=kind==='button'?meetingButtonLabels:bodyReportLabels;
    game().path.push(labels[actor]);
    save();
    render();
    toast(`${labels[actor].slice(3)}を経路に追加しました`);
  }

  function meetingContextFromLastPathEvent() {
    const last=game().path[game().path.length-1];
    if (last===meetingButtonLabels.self) return {type:'button',reporter:game().me};
    if (last===meetingButtonLabels.other) return {type:'button',reporter:''};
    if (last===bodyReportLabels.self) return {type:'report',reporter:game().me};
    if (last===bodyReportLabels.other) return {type:'report',reporter:''};
    return null;
  }

  function updateMeetingTypeFields() {
    const report=pendingMeeting.type==='report';
    const hasVictim=pendingMeeting.victims.length>0;
    $('#bodyPlaceWrap').classList.toggle('hidden',!report);
    $('#meetingVictimSummary').classList.toggle('hidden',!hasVictim);
  }

  function showMeetingStep(id) {
    ['meetingReporterStep','meetingKillStep','meetingVictimStep','meetingRepairerStep','meetingDetailsStep'].forEach(stepId=>$('#'+stepId).classList.toggle('hidden',stepId!==id));
    $('#saveMeeting').classList.toggle('hidden',id!=='meetingDetailsStep');
  }

  function showMeetingReporterStep() {
    showMeetingStep('meetingReporterStep');
  }

  function continueMeetingFlow() {
    if (!pendingMeeting.reporter) return showMeetingReporterStep();
    if (pendingMeeting.type==='button' && pendingMeeting.killOccurred===null) return showMeetingStep('meetingKillStep');
    if (pendingMeeting.type==='report') pendingMeeting.killOccurred=true;
    if (pendingMeeting.killOccurred && (!pendingMeeting.victimsConfirmed || !pendingMeeting.victims.length)) return showMeetingVictimStep();
    updateMeetingTypeFields();
    renderMeetingRepairSummary();
    showMeetingStep('meetingDetailsStep');
    requestAnimationFrame(() => $('#witness').focus());
  }

  function selectMeetingReporter(id) {
    const reporter=activePlayers().find(player=>player.id===id);
    if (!reporter) return;
    const blockReason=meetingReporterBlockReason(reporter);
    if (blockReason) return toast(blockReason);
    pendingMeeting.reporter=reporter.id;
    $('#meetingReporterName').textContent=`${reporter.name}（${meetingShortcutLabel(reporter.meetingNumber)}）`;
    continueMeetingFlow();
  }

  function selectMeetingKillOccurred(killOccurred) {
    pendingMeeting.killOccurred=killOccurred;
    if (!killOccurred) {
      pendingMeeting.victims=[];
      pendingMeeting.victimsConfirmed=true;
    } else {
      pendingMeeting.victimsConfirmed=false;
    }
    continueMeetingFlow();
  }

  function showMeetingVictimStep() {
    pendingMeeting.victimsConfirmed=false;
    renderMeetingVictimList();
    showMeetingStep('meetingVictimStep');
  }

  function selectMeetingVictim(id) {
    const victim=activePlayers().find(player=>player.id===id && !unavailableVictim(player));
    if (!victim) return;
    const selectedIndex=pendingMeeting.victims.indexOf(victim.id);
    if (selectedIndex===-1) pendingMeeting.victims.push(victim.id);
    else pendingMeeting.victims.splice(selectedIndex,1);
    pendingMeeting.victimsConfirmed=false;
    renderMeetingVictimList();
  }

  function confirmMeetingVictims() {
    if (!pendingMeeting.victims.length) return toast('死亡者を1名以上選択してください');
    pendingMeeting.victimsConfirmed=true;
    $('#meetingVictimName').textContent=pendingMeeting.victims.map(id => {
      const victim=activePlayers().find(player=>player.id===id);
      return victim ? `${victim.name}（${meetingShortcutLabel(victim.meetingNumber)}）` : playerName(id);
    }).join('、');
    continueMeetingFlow();
  }

  function showMeetingRepairerStep(index) {
    const repair=pendingMeeting.repairs[index];
    if (!repair) return;
    pendingMeeting.activeRepairIndex=index;
    pendingMeeting.repairDraft=[...repair.selected];
    renderMeetingRepairerList();
    showMeetingStep('meetingRepairerStep');
  }

  function selectMeetingRepairer(id) {
    const player=activePlayers().find(candidate=>candidate.id===id);
    if (!player) return;
    if (player.id===game().me) return toast('自分以外の修理者を選択してください');
    const selectedIndex=pendingMeeting.repairDraft.indexOf(player.id);
    if (selectedIndex===-1) pendingMeeting.repairDraft.push(player.id);
    else pendingMeeting.repairDraft.splice(selectedIndex,1);
    renderMeetingRepairerList();
  }

  function closeMeetingRepairerStep() {
    pendingMeeting.activeRepairIndex=-1;
    pendingMeeting.repairDraft=[];
    renderMeetingRepairSummary();
    showMeetingStep('meetingDetailsStep');
  }

  function confirmMeetingRepairers() {
    const repair=activeMeetingRepair();
    if (!repair) return;
    if (repair.mode==='other' && !pendingMeeting.repairDraft.length) return toast('修理者を1名以上選択してください');
    repair.selected=[...pendingMeeting.repairDraft];
    repair.confirmed=true;
    closeMeetingRepairerStep();
  }

  function meetingNumberFromShortcut(event) {
    if (event.altKey || event.ctrlKey || event.metaKey) return 0;
    if (event.shiftKey) {
      const match=event.code.match(/^Digit([1-3])$/);
      return match ? 10+Number(match[1]) : 0;
    }
    if (event.code==='Digit0') return 10;
    const match=event.code.match(/^Digit([1-9])$/);
    return match ? Number(match[1]) : 0;
  }

  function openMeetingDialog(type='button',reporter='') {
    if (!state.session) return toast('先に参加者を確定してゲームを開始してください');
    const repairs=meetingRepairCandidatesFromCurrentPath();
    commitTurn();
    pendingMeeting={type,reporter:'',killOccurred:type==='report'?true:null,victims:[],victimsConfirmed:false,repairs,activeRepairIndex:-1,repairDraft:[]};
    fillMeeting();
    $('#meetingTypeLabel').textContent=type==='button'?'ボタン':'死体通報';
    updateMeetingTypeFields();
    $('#meetingDialog').showModal();
    if (reporter) selectMeetingReporter(reporter);
    else continueMeetingFlow();
  }

  function openMeetingFromLastPathEvent() {
    if (!state.session) return toast('先に参加者を確定してゲームを開始してください');
    const context=meetingContextFromLastPathEvent();
    if (!context) return toast('経路の最後に会議ボタンまたは死体通報を記録してください');
    openMeetingDialog(context.type,context.reporter);
  }

  document.addEventListener('keydown', event => {
    const meetingDialogOpen=$('#meetingDialog').open;
    if (meetingDialogOpen && state.shortcutsEnabled) {
      const choosingKill=!$('#meetingKillStep').classList.contains('hidden');
      const choosingReporter=!$('#meetingReporterStep').classList.contains('hidden');
      const choosingVictim=!$('#meetingVictimStep').classList.contains('hidden');
      const choosingRepairer=!$('#meetingRepairerStep').classList.contains('hidden');
      if (choosingVictim && event.metaKey && event.key==='Enter' && !event.shiftKey && !event.altKey && !event.ctrlKey) {
        confirmMeetingVictims();
        event.preventDefault();
        return;
      }
      if (choosingRepairer && event.metaKey && event.key==='Enter' && !event.shiftKey && !event.altKey && !event.ctrlKey) {
        confirmMeetingRepairers();
        event.preventDefault();
        return;
      }
      if (choosingKill && !event.shiftKey && !event.altKey && !event.ctrlKey && !event.metaKey && (event.code==='Digit1' || event.code==='Digit2')) {
        selectMeetingKillOccurred(event.code==='Digit1');
        event.preventDefault();
        return;
      }
      if (choosingReporter || choosingVictim || choosingRepairer) {
        const number=meetingNumberFromShortcut(event);
        const player=activePlayers().find(candidate=>candidate.meetingNumber===number);
        if (player) {
          if (choosingReporter) {
            const blockReason=meetingReporterBlockReason(player);
            if (blockReason) toast(blockReason);
            else selectMeetingReporter(player.id);
          } else if (choosingVictim && unavailableVictim(player)) {
            toast(`${player.name}はすでに${player.status==='dead'?'死亡':'追放'}済みです`);
          } else if (choosingVictim) selectMeetingVictim(player.id);
          else selectMeetingRepairer(player.id);
          event.preventDefault();
          return;
        }
      }
    }
    if (document.querySelector('dialog[open]')) return;
    if (!state.shortcutsEnabled) return;
    const isMeetingConfirm=event.metaKey && event.key==='Enter' && !event.shiftKey && !event.altKey && !event.ctrlKey;
    if (isMeetingConfirm) {
      openMeetingFromLastPathEvent();
      event.preventDefault();
      return;
    }
    if (event.target.matches('input,textarea,select')) return;
    if (event.key==='Backspace') {
      if (game().path.length) removePathAt(game().path.length-1);
      save();
      render();
      event.preventDefault();
      return;
    }
    const sabotageType=SABOTAGE_SHORTCUTS[event.code];
    const hasUnsupportedModifier=event.altKey || event.ctrlKey || (event.metaKey && !event.shiftKey);
    if (sabotageType && !hasUnsupportedModifier) {
      const mode=event.metaKey&&event.shiftKey?'other':event.shiftKey?'occurred':'self';
      quickSabotage(sabotageType,mode);
      event.preventDefault();
      return;
    }
    const isPlainOrShift=!event.altKey && !event.ctrlKey && !event.metaKey;
    if (event.code==='Digit4' && isPlainOrShift) {
      quickMeetingEvent('button',event.shiftKey?'other':'self');
      event.preventDefault();
      return;
    }
    if (event.code==='Digit5' && isPlainOrShift) {
      quickMeetingEvent('report',event.shiftKey?'other':'self');
      event.preventDefault();
      return;
    }
    const found = AIRSHIP_ROOMS.find(([,key]) => key===event.key);
    if (found) {
      game().path.push(found[0]);
      save();
      render();
      event.preventDefault();
    }
  });

  $('#seen').oninput = event => { game().seen=event.target.value; save(); };
  $('#turnNote').oninput = event => { game().note=event.target.value; save(); };
  $('#shortcutToggle').onclick = () => {
    state.shortcutsEnabled=!state.shortcutsEnabled;
    save();
    render();
    toast(`ショートカットを${state.shortcutsEnabled?'ON':'OFF'}にしました`);
  };
  $('#finishTurn').onclick = nextTurn;
  $('#openMeeting').onclick = () => openMeetingDialog('button');
  $('#addSabo').onclick = () => { $('#saboFixer').innerHTML=playerOptions(); openDialog('#saboDialog'); };
  $('#saveSabo').onclick = () => {
    const fixer=$('#saboFixer').value, type=$('#saboType').value;
    if (!fixer) return toast('修理者を選択してください');
    recordSabotage(type,{fixer,place:$('#saboPlace').value.trim(),note:$('#saboNote').value.trim(),addToPath:fixer===game().me});
    $('#saboDialog').close();
    save();
    render();
    toast(fixer===game().me?'修理を経路に追加しました':'修理を記録しました');
  };
  $('#changeMeetingReporter').onclick = showMeetingReporterStep;
  $('#changeMeetingVictim').onclick = showMeetingVictimStep;
  $('#confirmMeetingVictims').onclick = confirmMeetingVictims;
  $('#confirmMeetingRepairers').onclick = confirmMeetingRepairers;
  $('#cancelMeetingRepairers').onclick = closeMeetingRepairerStep;
  $('#saveMeeting').onclick = () => {
    const type=pendingMeeting.type, reporter=pendingMeeting.reporter;
    const victims=[...pendingMeeting.victims];
    const killOccurred=type==='report' || pendingMeeting.killOccurred===true;
    if (!reporter) return toast('起票者を選択してください');
    if (type==='button' && pendingMeeting.killOccurred===null) return toast('キル発生の有無を選択してください');
    if (killOccurred && (!pendingMeeting.victimsConfirmed || !victims.length)) return toast('死亡者を選択して確定してください');
    const ids=[...$('#alibiPeople').querySelectorAll(':checked')].map(element=>element.value);
    const reason=$('#alibiReason').value.trim();
    const alibis=ids.map(player=>({player,reason}));
    const repairs=pendingMeeting.repairs.map(repair=>{
      const sabotage=game().sabotages[repair.sabotageIndex];
      const repairers=repair.mode==='self'
        ? [...new Set([game().me,...(repair.confirmed?repair.selected:[])])]
        : repair.confirmed ? [...repair.selected] : sabotageRepairerIds(sabotage);
      if (sabotage && repair.confirmed) sabotage.repairers=repairers;
      return {type:repair.type,mode:repair.mode,repairers,confirmed:repair.confirmed};
    });
    const meeting={kind:'meeting',turn:game().turn,type,reporter,killOccurred,victims:killOccurred?victims:[],victim:killOccurred?(victims[0]||''):'',bodyPlace:type==='report'?$('#bodyPlace').value.trim():'',witness:$('#witness').value.trim(),note:$('#meetingNote').value.trim(),result:$('#meetingResult').value.trim(),alibis,repairs};
    game().timeline.push(meeting);
    if (killOccurred) {
      for (const victim of victims) {
        const player=activePlayers().find(candidate=>candidate.id===victim);
        if (player) player.status='dead';
        game().deaths.push({...meeting,victim});
      }
    }
    $('#meetingDialog').close();
    game().turn++;
    save();
    render();
    toast(`会議を保存。T${game().turn} を開始しました`);
  };

  $('#manageMembers').onclick = () => { renderMemberList(); openDialog('#membersDialog'); };
  function renderMemberList() {
    $('#memberList').innerHTML=state.members.length
      ? state.members.map(member=>{
        const isSelf=selfPlayer?.id===member.id;
        return `<div class="row card"><span class="grow">${esc(member.name)}${isSelf?' <span class="pill alive">自分</span>':''}</span>${isSelf?'':`<button class="danger small" data-delete-member="${esc(member.id)}">削除</button>`}</div>`;
      }).join('')
      : '<p class="empty">メンバーがいません。</p>';
  }
  async function registerMember(rawName) {
    const name=rawName.trim();
    if (!name) return;
    if (state.members.some(member=>member.name.normalize('NFKC').toLocaleLowerCase('ja-JP')===name.normalize('NFKC').toLocaleLowerCase('ja-JP'))) return toast('同じ名前のメンバーが登録されています');
    const member={id:createId('member'),name};
    let savedImmediately=serverConnected&&apiVersion>=REQUIRED_API_VERSION;
    if (savedImmediately) {
      try { await apiRequest('/api/players',{method:'POST',body:JSON.stringify({players:[member]})}); }
      catch (error) {
        if (error.status!==404) { toast(`メンバーを保存できませんでした：${error.message}`); return; }
        apiVersion=1;
        savedImmediately=false;
        updateServerStatus('offline','旧サーバー・再起動が必要');
      }
    }
    state.members.push(member);
    save();
    render();
    toast(savedImmediately?'メンバーを登録しました':serverConnected?'一時登録しました。ゲーム終了時に保存されます':'ブラウザ内に一時登録しました');
    return member;
  }
  async function addMember() {
    const member=await registerMember($('#newMemberName').value);
    if (!member) return;
    $('#newMemberName').value='';
    renderMemberList();
  }
  $('#addMember').onclick = addMember;
  $('#newMemberName').onkeydown = event => {
    if (event.key !== 'Enter' || event.isComposing) return;
    event.preventDefault();
    addMember();
  };
  $('#memberList').onclick = async event => {
    const button=event.target.closest('[data-delete-member]');
    if (!button) return;
    const id=button.dataset.deleteMember;
    if (selfPlayer?.id===id) return;
    const member=state.members.find(player=>player.id===id);
    if (!confirm(`${member?.name||'このプレイヤー'}を削除しますか？`)) return;
    if (serverConnected) {
      try { await apiRequest(`/api/players/${encodeURIComponent(id)}`,{method:'DELETE',body:JSON.stringify({name:member?.name||'player'})}); }
      catch (error) { toast(`削除できませんでした：${error.message}`); return; }
    }
    state.members=state.members.filter(member=>member.id!==id);
    game().participants=game().participants.filter(member=>member.id!==id);
    if (state.lastRoster) state.lastRoster.ids=state.lastRoster.ids.filter(memberId=>memberId!==id);
    if (game().me===id) game().me='';
    if (game().host===id) game().host='';
    if (state.lastRoster?.host===id) state.lastRoster.host='';
    save();
    renderMemberList();
    render();
  };

  function openRosterDialog(mode,selectedIds=[],host='') {
    rosterMode=mode;
    const selected=new Set(selectedIds);
    if (selfPlayer) selected.add(selfPlayer.id);
    if (!selected.has(host)) host='';
    $('#rosterTitle').textContent=mode==='next'?'次のゲームの参加者を選択':'本日の参加者を選択';
    $('#startRoster').textContent='参加者を確定';
    $('#rosterList').innerHTML=state.members.length
      ? state.members.map(member=>{
        const isSelf=selfPlayer?.id===member.id;
        return `<div class="card"><span>${esc(member.name)}${isSelf?' <span class="pill alive">自分</span>':''}</span><button type="button" class="roster-toggle participant ${selected.has(member.id)?'selected':''}" data-roster-player="${esc(member.id)}" aria-pressed="${selected.has(member.id)}" ${isSelf?'disabled':''}>${selected.has(member.id)?'参加中':'参加する'}</button><button type="button" class="roster-toggle host ${host===member.id?'selected':''}" data-roster-host="${esc(member.id)}" aria-pressed="${host===member.id}">${host===member.id?'ホスト':'ホストにする'}</button></div>`;
      }).join('')
      : '<p class="empty">先にメンバー管理からプレイヤーを登録してください。</p>';
    updateRosterCount();
    if (!$('#rosterDialog').open) openDialog('#rosterDialog');
  }

  function updateRosterCount() {
    const count=$('#rosterList').querySelectorAll('[data-roster-player].selected').length;
    $('#rosterCount').textContent=`${count}名を選択中`;
  }

  function setRosterToggle(button,selected,selectedLabel,unselectedLabel) {
    button.classList.toggle('selected',selected);
    button.setAttribute('aria-pressed',String(selected));
    button.textContent=selected?selectedLabel:unselectedLabel;
  }

  function currentRosterSelection() {
    return {
      ids:[...$('#rosterList').querySelectorAll('[data-roster-player].selected')].map(button=>button.dataset.rosterPlayer),
      host:$('#rosterList').querySelector('[data-roster-host].selected')?.dataset.rosterHost || ''
    };
  }

  $('#rosterList').onclick = event => {
    const playerButton=event.target.closest('[data-roster-player]');
    if (playerButton) {
      const selected=!playerButton.classList.contains('selected');
      setRosterToggle(playerButton,selected,'参加中','参加する');
      if (!selected) {
        const host=$(`[data-roster-host="${playerButton.dataset.rosterPlayer}"]`);
        if (host) setRosterToggle(host,false,'ホスト','ホストにする');
      }
      updateRosterCount();
      return;
    }
    const hostButton=event.target.closest('[data-roster-host]');
    if (!hostButton) return;
    const selected=!hostButton.classList.contains('selected');
    $('#rosterList').querySelectorAll('[data-roster-host]').forEach(button=>setRosterToggle(button,false,'ホスト','ホストにする'));
    if (!selected) {
      updateRosterCount();
      return;
    }
    setRosterToggle(hostButton,true,'ホスト','ホストにする');
    const player=$(`[data-roster-player="${hostButton.dataset.rosterHost}"]`);
    if (player) setRosterToggle(player,true,'参加中','参加する');
    updateRosterCount();
  };

  async function addMemberFromRoster() {
    const selection=currentRosterSelection();
    const member=await registerMember($('#rosterNewMemberName').value);
    if (!member) return;
    $('#rosterNewMemberName').value='';
    selection.ids.push(member.id);
    openRosterDialog(rosterMode,selection.ids,selection.host);
  }
  $('#addRosterMember').onclick = addMemberFromRoster;
  $('#rosterNewMemberName').onkeydown = event => {
    if (event.key!=='Enter'||event.isComposing) return;
    event.preventDefault();
    addMemberFromRoster();
  };

  $('#startRoster').onclick = () => {
    const {ids:selectedIds,host}=currentRosterSelection();
    if (selfPlayer&&!selectedIds.includes(selfPlayer.id)) selectedIds.unshift(selfPlayer.id);
    if (!host) return toast('ホストを1名選択してください');
    if (!selectedIds.includes(host)) return toast('ホストを参加者に含めてください');
    pendingRoster={mode:rosterMode,selectedIds,host};
    $('#gameRules').value=state.lastRules||'';
    $('#gameRole').value='';
    $('#rosterDialog').close();
    openDialog('#gameSettingsDialog');
  };

  $('#backToRoster').onclick = () => {
    $('#gameSettingsDialog').close();
    if (pendingRoster) openRosterDialog(pendingRoster.mode,pendingRoster.selectedIds,pendingRoster.host);
  };

  $('#confirmGameSettings').onclick = () => {
    if (!pendingRoster) return;
    const rules=$('#gameRules').value.trim();
    const role=$('#gameRole').value.trim();
    if (!role) return toast('今回の自分の役職を入力してください');
    if (!state.session) state.session={id:createId('session'),startedAt:new Date().toISOString(),gameNumber:1,awaitingNext:false};
    else if (pendingRoster.mode==='next') {
      state.session.gameNumber++;
      state.session.awaitingNext=false;
    }
    state.game=createGameState(pendingRoster.selectedIds,pendingRoster.host,state.session.gameNumber,state.session.id);
    state.game.rules=rules;
    state.game.role=role;
    state.lastRules=rules;
    ensureSelfPlayer();
    $('#gameSettingsDialog').close();
    pendingRoster=null;
    save();
    render();
    toast(`ゲーム ${state.session.gameNumber} を開始しました`);
  };
  $('#cancelRoster').onclick = () => $('#rosterDialog').close();

  document.querySelectorAll('.closeDialog').forEach(button => button.onclick=()=>button.closest('dialog').close());
  $('#newGame').onclick = () => {
    if (state.session?.awaitingNext) openRosterDialog('next',state.lastRoster?.ids||[],state.lastRoster?.host||'');
    else if (!state.session) openRosterDialog('first');
  };

  async function saveCurrentGame() {
    commitTurn();
    save('終了データを保存中…');
    updateServerStatus('online','保存中…');
    if (!serverConnected) throw new Error('ローカルサーバーに接続されていません。データはブラウザ内に残っています');
    if (!game().id) game().id=createId('game');
    const result=await apiRequest('/api/games/end',{method:'POST',body:JSON.stringify({players:state.members.map(({id,name})=>({id,name})),game:game()})});
    const summary=`新規${result.players.created.length}・更新${result.players.updated.length}・変更なし${result.players.unchanged.length}`;
    save(`ゲーム保存完了（${summary}）`);
    updateServerStatus('online','サーバー接続済み');
    return summary;
  }

  async function finishCurrentGame(continuePlaying) {
    const buttons=[$('#saveAndContinue'),$('#saveAndEnd')];
    buttons.forEach(button=>button.disabled=true);
    const roster={ids:activePlayers().map(player=>player.id),host:game().host};
    try {
      const summary=await saveCurrentGame();
      state.lastRoster=roster;
      $('#endGameDialog').close();
      if (continuePlaying) {
        state.session.awaitingNext=true;
        save(`ゲーム保存完了（${summary}）`);
        render();
        openRosterDialog('next',roster.ids,roster.host);
      } else {
        state.session=null;
        state.game=createGameState();
        ensureSelfPlayer();
        save(`本日のゲームを終了（${summary}）`);
        render();
        toast('ゲームデータを保存して終了しました');
      }
    } catch (error) {
      save('保存失敗・ブラウザ内に保持中');
      updateServerStatus('offline','保存失敗');
      toast(error.message);
    } finally {
      buttons.forEach(button=>button.disabled=false);
    }
  }

  $('#endGame').onclick = () => openDialog('#endGameDialog');
  $('#saveAndContinue').onclick = () => finishCurrentGame(true);
  $('#saveAndEnd').onclick = () => finishCurrentGame(false);
  $('#importMembers').onclick = () => $('#memberFile').click();
  $('#memberFile').onchange = async event => {
    const files=[...event.target.files];
    if (!files.length) return;
    try {
      const imported=[];
      for (const file of files) {
        const data=JSON.parse(await file.text());
        if (data.player?.name) imported.push(data.player);
        else if (Array.isArray(data.members)) imported.push(...data.members);
        else throw Error();
      }
      const validMembers=imported.filter(member=>member&&member.name).map(source=>({id:source.id||createId('member'),name:String(source.name)}));
      if (serverConnected&&apiVersion>=REQUIRED_API_VERSION&&validMembers.length) await apiRequest('/api/players',{method:'POST',body:JSON.stringify({players:validMembers})});
      for (const member of validMembers) {
        const existing=state.members.find(player=>player.id===member.id);
        if (existing) existing.name=member.name;
        else state.members.push(member);
        const participant=game().participants.find(player=>player.id===member.id);
        if (participant) participant.name=member.name;
      }
      ensureSelfPlayer();
      save();
      renderMemberList();
      render();
      toast(`${validMembers.length}名を読み込みました`);
    } catch {
      toast('正しいプレイヤーJSONではありません');
    }
    event.target.value='';
  };
  $('#copyLog').onclick = async () => {
    const lines=[`Among Memo / ${game().role}`,`自分: ${playerName(game().me)}`,`ホスト: ${playerName(game().host)}`,`ルール: ${game().rules||'—'}`,'',...game().timeline.map(item=>item.kind==='turn'
      ? `[T${item.turn}] 経路: ${item.path.join(' → ')||'—'} / 視認: ${item.seen||'—'} / ${item.note||''}`
      : `[会議 T${item.turn}] ${item.type==='button'?'ボタン':'通報'}: ${playerName(item.reporter)}${meetingVictimIds(item).length?` / 死亡: ${meetingVictimIds(item).map(playerName).join('、')} @ ${item.bodyPlace||'不明'}`:''}\n視認: ${item.witness||'—'} / 結果: ${item.result||'—'}${item.alibis?.length?`\nキル不可: ${item.alibis.map(alibi=>`${playerName(alibi.player)}（${alibi.reason||'理由なし'}）`).join('、')}`:''}`)];
    try {
      await navigator.clipboard.writeText(lines.join('\n'));
      toast('試合ログをコピーしました');
    } catch {
      toast('コピーできませんでした');
    }
  };

  async function initialize() {
    try {
      const bootstrap=await apiRequest('/api/bootstrap');
      apiToken=bootstrap.token;
      apiVersion=Number(bootstrap.apiVersion||1);
      serverConnected=true;
      selfPlayer=bootstrap.self ? {id:String(bootstrap.self.id),name:String(bootstrap.self.name)} : null;
      for (const player of bootstrap.players||[]) mergeServerPlayer(player);
      ensureSelfPlayer();
      if (!game().host) game().host='';
      if (!game().id) game().id=createId('game');
      save();
      updateServerStatus(apiVersion>=REQUIRED_API_VERSION?'online':'offline',apiVersion>=REQUIRED_API_VERSION?'サーバー接続済み':'旧サーバー・再起動が必要');
    } catch (error) {
      serverConnected=false;
      if (!game().id) game().id=createId('game');
      localStorage.setItem(STORAGE_KEY,JSON.stringify(state));
      updateServerStatus('offline','サーバー未接続');
      console.warn(error);
    }
    render();
    if (state.session?.awaitingNext) openRosterDialog('next',state.lastRoster?.ids||[],state.lastRoster?.host||'');
    else if (!state.session) openRosterDialog('first');
  }

  initialize();
})();
