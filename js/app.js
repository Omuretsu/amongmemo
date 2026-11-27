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
  let pendingMeeting = {type:'button',reporter:'',killOccurred:null,victims:[],victimsConfirmed:false,reportedVictim:'',repairs:[],activeRepairIndex:-1,repairDraft:[],bodyReports:[],activeBodyIndex:-1,bodyWitnessDraft:[],sheriffDraft:null,lastLocation:''};

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

  const bodyReporterId = body => body?.reporter || body?.finder || '';
  const bodySheriffExecutorId = body => body?.sheriffExecutor || (body?.sheriffExecution ? bodyReporterId(body) : '');

  function meetingBodyReports(meeting) {
    if (Array.isArray(meeting.bodyReports) && meeting.bodyReports.length) return meeting.bodyReports.map(body=>({...body,reporter:bodyReporterId(body),witnesses:Array.isArray(body.witnesses)?body.witnesses:[],sheriffExecutor:bodySheriffExecutorId(body),sheriffCounterclaim:Boolean(body.sheriffCounterclaim),sheriffCounterPlayer:body.sheriffCounterPlayer||''}));
    return meetingVictimIds(meeting).map(victim=>({victim,reporter:meeting.reporter||'',place:meeting.bodyPlace||'',witnesses:[],unknown:!meeting.reporter,sheriffExecution:false,sheriffExecutor:'',sheriffCounterclaim:false,sheriffCounterPlayer:'',falsified:false}));
  }

  function meetingBodiesText(meeting) {
    return meetingBodyReports(meeting).map(body=>{
      if (body.unknown) return `${playerName(body.victim)}：死体情報不明`;
      const reporter=body.unknown || !bodyReporterId(body) ? '不明' : playerName(bodyReporterId(body));
      const place=body.unknown || !body.place ? '場所不明' : body.place;
      const witnesses=body.witnesses?.length ? `（同時目撃：${body.witnesses.map(playerName).join('、')}）` : '';
      const execution=body.sheriffExecution ? `（${playerName(bodySheriffExecutorId(body))}がシェリフ執行${body.sheriffCounterclaim&&body.sheriffCounterPlayer?`、対抗：${playerName(body.sheriffCounterPlayer)}`:''}）` : '';
      return `${playerName(body.victim)}：${reporter}が${place}で通報${witnesses}${execution}${body.falsified?'（位置偽装）':''}`;
    }).join(' ／ ');
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

  const PLAYER_STATUSES = [
    ['alive','生存'],
    ['dead','死亡'],
    ['ejected','追放'],
    ['linked','道連れ'],
    ['executed','執行'],
    ['misfire','誤爆']
  ];
  const normalizedPlayerStatus = status => PLAYER_STATUSES.some(([value])=>value===status) ? status : 'alive';
  const playerStatusLabel = status => PLAYER_STATUSES.find(([value])=>value===normalizedPlayerStatus(status))?.[1] || '生存';
  const mutedPlayerStatus = status => ['dead','ejected','linked','executed','misfire'].includes(normalizedPlayerStatus(status));
  const PLAYER_SPECIAL_STATUSES = {
    sheriff:{icon:'⚔️',label:'シェリフCO'},
    madmate:{icon:'👿',label:'マッドメイト'}
  };
  const playerIcon = (icon,active,label) => `<span class="player-icon${active?' active':' inactive'}" ${active?`title="${label}" aria-label="${label}"`:'aria-hidden="true"'}>${icon}</span>`;
  const playerSpecialIcon = player => {
    const status=PLAYER_SPECIAL_STATUSES[player.specialStatus];
    return playerIcon(status?.icon||'⚔️',Boolean(status),status?.label||'特殊状態');
  };
  const playerStatusButtons = player => {
    const status=normalizedPlayerStatus(player.status);
    return `<div class="player-statuses" role="group" aria-label="${esc(player.name)}のステータス">${PLAYER_STATUSES.map(([value,label])=>`<button type="button" class="player-status status-${value}${status===value?' selected':''}" data-status="${esc(player.id)}" data-status-value="${value}" aria-pressed="${status===value}">${label}</button>`).join('')}</div>`;
  };
  const playerCard = (player,buttonUsers,repairerIcons) => `<div class="player${mutedPlayerStatus(player.status)?' player-muted':''}"><div class="player-identity"><span class="player-name">${esc(player.name)}${player.id===game().host?' <span class="pill">ホスト</span>':''}</span><span class="player-icons">${playerIcon('🛎️',buttonUsers.has(player.id),'会議ボタン使用済み')}${playerIcon('⚡️',repairerIcons.blackout.has(player.id),'停電の修理者')}${playerIcon('📡',repairerIcons.communications.has(player.id),'コミュニケーションの修理者')}${playerSpecialIcon(player)}</span></div>${playerStatusButtons(player)}</div>`;

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
      ? activePlayers().map(player => playerCard(player,buttonUsers,repairerIcons)).join('')
      : '<p class="empty">メンバー管理から参加者を登録してください。</p>';
    $('#path').innerHTML = game().path.length
      ? game().path.map((room,index) => `<span class="room ${isSabotagePathLabel(room)?'repair':''}">${esc(room)} <button data-remove-path="${index}" title="削除">×</button></span>`).join(' → ')
      : '<span class="meta">移動先を追加</span>';
    $('#seen').value = game().seen;
    $('#turnNote').value = game().note;
    $('#timeline').innerHTML = game().timeline.length
      ? [...game().timeline].reverse().map(item => item.kind==='turn'
        ? `<article class="card"><h3>T${item.turn} <span class="pill">行動</span></h3><div class="detail"><b>経路：</b>${esc(item.path.join(' → ') || '—')}<br><b>視認：</b>${esc(item.seen || '—')}<br><b>メモ：</b>${esc(item.note || '—')}</div></article>`
        : `<article class="card meeting"><h3>会議 ${item.type==='button'?'緊急ボタン':'死体通報'} <span class="pill">T${item.turn}</span></h3><div class="detail"><b>起票：</b>${esc(playerName(item.reporter))}${meetingVictimIds(item).length?`<br><b>死体：</b>${esc(meetingBodiesText(item))}`:''}<br><b>視認：</b>${esc(item.witness||'—')}${meetingRepairText(item)?`<br><b>妨害修理：</b>${esc(meetingRepairText(item))}`:''}<br><b>結果：</b>${esc(item.result||'—')}<br><b>メモ：</b>${esc(item.note||'—')}</div>${item.alibis?.length?`<div class="tags">${item.alibis.map(alibi=>`<span class="tag">${esc(playerName(alibi.player))}：${esc(alibi.reason||'白根拠')}</span>`).join('')}</div>`:''}</article>`).join('')
      : '<p class="empty">まだ記録はありません。</p>';
    $('#saboLog').innerHTML = game().sabotages.length
      ? [...game().sabotages].reverse().map(sabotage => {
        const repairers=sabotageRepairerIds(sabotage);
        const repairerLabel=repairers.length ? repairers.map(playerName).join('、') : sabotage.fixer===OTHER_FIXER ? '他者（未特定）' : playerName(sabotage.fixer);
        return `<article class="card"><h3>T${sabotage.turn} ${esc(normalizeSabotageType(sabotage.type))}</h3><div class="detail">${sabotage.action==='occurred'?'<b>状態：</b>発生':`<b>修理：</b>${esc(repairerLabel)}`}${sabotage.place?` @ ${esc(sabotage.place)}`:''}${sabotage.note?`<br>${esc(sabotage.note)}`:''}</div></article>`;
      }).join('')
      : '<p class="empty">妨害の記録はありません。</p>';
    $('#deathBoard').innerHTML = game().deaths.length
      ? [...game().deaths].reverse().map(death => {
        const reporter=bodyReporterId(death);
        const place=death.place||death.bodyPlace||'';
        const bodyWitnesses=death.witnesses?.length ? death.witnesses.map(playerName).join('、') : '—';
        const executionDetail=death.sheriffExecution ? `<br><b>シェリフ執行：</b>${esc(playerName(bodySheriffExecutorId(death)))}${death.sheriffCounterclaim&&death.sheriffCounterPlayer?`／対抗：${esc(playerName(death.sheriffCounterPlayer))}（⚔️なし）`:'／対抗なし'}` : '';
        return `<article class="card meeting"><h3>${esc(playerName(death.victim))} <span class="${death.sheriffExecution?'ejected':'dead'}">${death.sheriffExecution?'執行':'死亡'}</span> <small>T${death.turn}</small></h3><div class="detail"><b>通報：</b>${death.unknown===true || !reporter?'不明':esc(playerName(reporter))} @ ${esc(place||'不明')}${death.falsified?'（位置偽装）':''}<br><b>同時目撃：</b>${esc(bodyWitnesses)}${executionDetail}<br><b>視認：</b>${esc(death.witness||'—')}</div>${death.alibis?.length?`<div class="tags">${death.alibis.map(alibi=>`<span class="tag">キル不可：${esc(playerName(alibi.player))}<br>${esc(alibi.reason||'理由未記入')}</span>`).join('')}</div>`:'<div class="meta">キル不可能者は未記録</div>'}</article>`;
      }).join('')
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
  const unavailableVictim = player => ['dead','ejected','linked','executed','misfire'].includes(player.status);
  const activeMeetingBody = () => pendingMeeting.bodyReports[pendingMeeting.activeBodyIndex] || null;
  const meetingSheriffParticipantBlockReason = (player,kind) => {
    if (pendingMeeting.victims.includes(player.id)) return '今回の死亡者は選択できません';
    if (normalizedPlayerStatus(player.status)!=='alive') return `${playerStatusLabel(player.status)}のプレイヤーは選択できません`;
    if (kind==='sheriffCounterPlayer' && player.id===pendingMeeting.sheriffDraft?.executor) return '執行者本人は対抗CO者にできません';
    return '';
  };
  const meetingBodyFinderBlockReason = player => {
    if (pendingMeeting.victims.includes(player.id)) return '今回の死亡者は通報者にできません';
    if (normalizedPlayerStatus(player.status)!=='alive') return `${playerStatusLabel(player.status)}のプレイヤーは通報者にできません`;
    return '';
  };
  const meetingBodyWitnessBlockReason = player => {
    const body=activeMeetingBody();
    if (!body) return '対象の死体が選択されていません';
    if (player.id===bodyReporterId(body)) return '通報者は追加の目撃者に含めません';
    if (pendingMeeting.victims.includes(player.id)) return '今回の死亡者は目撃者にできません';
    if (normalizedPlayerStatus(player.status)!=='alive') return `${playerStatusLabel(player.status)}のプレイヤーは目撃者にできません`;
    return '';
  };
  const meetingReporterBlockReason = player => {
    if (normalizedPlayerStatus(player.status)!=='alive') return `${playerStatusLabel(player.status)}のプレイヤーは会議起票者にできません`;
    if (pendingMeeting.type!=='button') return '';
    if (meetingButtonUserIds().has(player.id)) return 'すでに会議ボタンを使用しています';
    return '';
  };
  const meetingPersonButton = (player,kind) => {
    const reporterBlocked=kind==='reporter' ? meetingReporterBlockReason(player) : '';
    const repairerBlocked=kind==='repairer' && player.id===game().me;
    const bodyFinderBlocked=kind==='bodyFinder' ? meetingBodyFinderBlockReason(player) : '';
    const bodyWitnessBlocked=kind==='bodyWitness' ? meetingBodyWitnessBlockReason(player) : '';
    const sheriffBlocked=['sheriffExecutor','sheriffCounterPlayer'].includes(kind) ? meetingSheriffParticipantBlockReason(player,kind) : '';
    const unavailable=kind==='victim' ? unavailableVictim(player) : kind==='repairer' ? repairerBlocked : kind==='bodyFinder' ? Boolean(bodyFinderBlocked) : kind==='bodyWitness' ? Boolean(bodyWitnessBlocked) : ['sheriffExecutor','sheriffCounterPlayer'].includes(kind) ? Boolean(sheriffBlocked) : Boolean(reporterBlocked);
    const selected=kind==='victim' ? pendingMeeting.victims.includes(player.id) : kind==='reportedBody' ? pendingMeeting.reportedVictim===player.id : kind==='repairer' ? pendingMeeting.repairDraft.includes(player.id) : kind==='bodyFinder' ? bodyReporterId(activeMeetingBody())===player.id : kind==='bodyWitness' ? pendingMeeting.bodyWitnessDraft.includes(player.id) : kind==='sheriffExecutor' ? pendingMeeting.sheriffDraft?.executor===player.id : kind==='sheriffCounterPlayer' ? pendingMeeting.sheriffDraft?.counterPlayer===player.id : false;
    const dataAttribute=kind==='victim'?'data-meeting-victim':kind==='reportedBody'?'data-meeting-reported-body':kind==='repairer'?'data-meeting-repairer':kind==='bodyFinder'?'data-meeting-body-finder':kind==='bodyWitness'?'data-meeting-body-witness':kind==='sheriffExecutor'?'data-meeting-sheriff-executor':kind==='sheriffCounterPlayer'?'data-meeting-sheriff-counter-player':'data-meeting-reporter';
    const status=normalizedPlayerStatus(player.status)==='alive'?'':playerStatusLabel(player.status);
    const usedButton=kind==='reporter' && meetingButtonUserIds().has(player.id);
    const blockedReason=reporterBlocked || bodyFinderBlocked || bodyWitnessBlocked || sheriffBlocked || (repairerBlocked?'自分以外の修理者を選択してください':'');
    return `<button type="button" class="meeting-person${selected?' selected':''}" ${dataAttribute}="${esc(player.id)}" ${['victim','reportedBody','repairer','bodyFinder','bodyWitness','sheriffExecutor','sheriffCounterPlayer'].includes(kind)?`aria-pressed="${selected}"`:''} ${unavailable?'disabled aria-disabled="true"':''} ${blockedReason?`title="${esc(blockedReason)}"`:''}><span class="meeting-player-number">${player.meetingNumber}</span><span class="meeting-player-name">${esc(player.name)}${usedButton?' <span class="meeting-button-used" aria-label="会議ボタン使用済み">🛎️</span>':''}${status?` <span class="meeting-player-status">${status}</span>`:''}</span><kbd class="meeting-key">${meetingShortcutLabel(player.meetingNumber)}</kbd></button>`;
  };

  function renderMeetingVictimList() {
    const players=activePlayers().slice(0,13);
    $('#meetingVictimList').innerHTML = [...players].sort((left,right)=>Number(unavailableVictim(left))-Number(unavailableVictim(right)) || left.meetingNumber-right.meetingNumber).map(player=>meetingPersonButton(player,'victim')).join('');
    $('#meetingVictimCount').textContent=`${pendingMeeting.victims.length}名を選択中`;
  }

  function renderMeetingReportedBodyList() {
    $('#meetingReportedBodyTitle').textContent=`${playerName(pendingMeeting.reporter)}が通報した死体を選択`;
    $('#meetingReportedBodyList').innerHTML=activePlayers().filter(player=>pendingMeeting.victims.includes(player.id)).sort((left,right)=>left.meetingNumber-right.meetingNumber).map(player=>meetingPersonButton(player,'reportedBody')).join('');
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

  function selfRoleKind() {
    const role=String(game().role||'').normalize('NFKC');
    if (role.includes('シェリフ')) return 'sheriff';
    if (role.includes('マッドメイト') || role.includes('マッド')) return 'madmate';
    if (role.includes('インポスター') || role.includes('インポ')) return 'impostor';
    if (role.includes('クルーメイト') || role.includes('クルー')) return 'crewmate';
    return 'other';
  }

  function lastRoomInPath(path) {
    const rooms=new Set(AIRSHIP_ROOMS.map(([room])=>room));
    return [...path].reverse().find(entry=>rooms.has(entry)) || '';
  }

  function clearSheriffExecution(body) {
    body.sheriffExecution=false;
    body.sheriffExecutor='';
    body.sheriffCounterclaim=false;
    body.sheriffCounterPlayer='';
  }

  function defaultMeetingBody(victim) {
    const isReportedBody=pendingMeeting.type==='report' && pendingMeeting.reportedVictim===victim;
    const selfReport=isReportedBody && pendingMeeting.reporter===game().me;
    const otherReport=isReportedBody && pendingMeeting.reporter && !selfReport;
    const reporter=selfReport ? game().me : otherReport ? pendingMeeting.reporter : '';
    const place=selfReport ? pendingMeeting.lastLocation : '';
    return {victim,reporter,place,actualPlace:place,witnesses:[],witnessesConfirmed:false,unknown:!reporter,falsified:false,sheriffExecution:false,sheriffExecutor:'',sheriffCounterclaim:false,sheriffCounterPlayer:'',autoReporter:Boolean(reporter)};
  }

  function ensureMeetingBodyReports() {
    const existing=new Map(pendingMeeting.bodyReports.map(body=>[body.victim,body]));
    pendingMeeting.bodyReports=pendingMeeting.victims.map(victim=>{
      const body=existing.get(victim)||defaultMeetingBody(victim);
      if (!Object.hasOwn(body,'reporter')) body.reporter=body.finder||'';
      if (!Array.isArray(body.witnesses)) body.witnesses=[];
      if (!Object.hasOwn(body,'witnessesConfirmed')) body.witnessesConfirmed=false;
      if (!Object.hasOwn(body,'sheriffExecutor')) body.sheriffExecutor=body.sheriffExecution ? bodyReporterId(body) : '';
      if (!Object.hasOwn(body,'sheriffCounterclaim')) body.sheriffCounterclaim=false;
      if (!Object.hasOwn(body,'sheriffCounterPlayer')) body.sheriffCounterPlayer='';
      return body;
    });
  }

  function renderMeetingBodyDetails() {
    ensureMeetingBodyReports();
    const hasBodies=pendingMeeting.killOccurred===true && pendingMeeting.bodyReports.length>0;
    $('#meetingBodyDetails').classList.toggle('hidden',!hasBodies);
    if (!hasBodies) {
      $('#meetingBodyRecords').innerHTML='';
      return;
    }
    const role=selfRoleKind();
    $('#meetingBodyRecords').innerHTML=pendingMeeting.bodyReports.map((body,index)=>{
      const reporter=bodyReporterId(body);
      const selfReporter=reporter===game().me;
      const reporterLabel=body.unknown || !reporter ? '不明' : selfReporter ? `${playerName(reporter)}（自分）` : playerName(reporter);
      const witnessesLabel=body.witnessesConfirmed ? (body.witnesses.length ? body.witnesses.map(playerName).join('、') : 'なし') : '未入力';
      const canFake=selfReporter && ['impostor','madmate'].includes(role);
      const canExecute=!body.unknown && Boolean(reporter);
      const fakeOption=canFake ? `<label><input type="checkbox" data-meeting-body-fake="${index}" ${body.falsified?'checked':''}>位置偽装として他の場所を記録</label>` : '';
      const executor=bodySheriffExecutorId(body);
      const executionSummary=body.sheriffExecution && executor ? `<span class="meeting-execution-summary">${esc(playerName(executor))}が執行／${body.sheriffCounterclaim&&body.sheriffCounterPlayer?`対抗：${esc(playerName(body.sheriffCounterPlayer))}（⚔️なし）`:'対抗なし（⚔️付与）'}</span>` : '';
      const executeOption=canExecute ? `<div class="meeting-execution-control">${executionSummary}<button type="button" class="secondary small${body.sheriffExecution?' selected':''}" data-meeting-body-execution-index="${index}">${body.sheriffExecution?'シェリフ執行を変更':'シェリフ執行を記録'}</button>${body.sheriffExecution?`<button type="button" class="secondary small" data-meeting-body-execution-clear="${index}">解除</button>`:''}</div>` : '';
      return `<article class="meeting-body-record${body.unknown?' unknown':''}"><div class="meeting-body-heading"><h4>${esc(playerName(body.victim))}の死体</h4>${body.unknown?'<span class="meeting-body-badge">不明</span>':''}</div><div><label>通報者</label><div class="meeting-body-control"><span>${esc(reporterLabel)}</span><button type="button" class="secondary small" data-meeting-body-index="${index}">${reporter?'変更':'選択'}</button></div></div><div><label>発見場所</label><div class="meeting-body-control"><span>${esc(body.place||'未入力')}</span><button type="button" class="secondary small" data-meeting-body-place-index="${index}" ${body.unknown?'disabled':''}>${body.place?'変更':'選択'}</button></div></div><div class="meeting-body-witnesses"><label>他に死体を目撃した人</label><div class="meeting-body-control"><span>${esc(witnessesLabel)}</span><button type="button" class="secondary small" data-meeting-body-witness-index="${index}" ${body.unknown?'disabled':''}>${body.witnessesConfirmed?'変更':'選択'}</button></div></div>${body.falsified&&body.actualPlace?`<div class="full meta">実際の最終位置：${esc(body.actualPlace)}</div>`:''}<div class="meeting-body-options">${fakeOption}${executeOption}</div></article>`;
    }).join('');
  }

  function renderMeetingBodyFinderList() {
    const body=activeMeetingBody();
    if (!body) return;
    $('#meetingBodyFinderTitle').textContent=`${playerName(body.victim)}の死体を通報した人`;
    $('#meetingBodyFinderList').innerHTML=activePlayers().slice(0,13).sort((left,right)=>Number(normalizedPlayerStatus(left.status)!=='alive')-Number(normalizedPlayerStatus(right.status)!=='alive') || left.meetingNumber-right.meetingNumber).map(player=>meetingPersonButton(player,'bodyFinder')).join('');
  }

  function renderMeetingBodyWitnessList() {
    const body=activeMeetingBody();
    if (!body) return;
    $('#meetingBodyWitnessTitle').textContent=`${playerName(body.victim)}の死体を同時に目撃した人`;
    $('#meetingBodyWitnessList').innerHTML=activePlayers().slice(0,13).sort((left,right)=>Number(Boolean(meetingBodyWitnessBlockReason(left)))-Number(Boolean(meetingBodyWitnessBlockReason(right))) || left.meetingNumber-right.meetingNumber).map(player=>meetingPersonButton(player,'bodyWitness')).join('');
    $('#meetingBodyWitnessCount').textContent=`${pendingMeeting.bodyWitnessDraft.length}名を選択中`;
  }

  function renderMeetingSheriffExecutorList() {
    const body=activeMeetingBody();
    if (!body) return;
    $('#meetingSheriffExecutorTitle').textContent=`${playerName(body.victim)}を執行した人を選択`;
    $('#meetingSheriffExecutorList').innerHTML=activePlayers().slice(0,13).sort((left,right)=>Number(Boolean(meetingSheriffParticipantBlockReason(left,'sheriffExecutor')))-Number(Boolean(meetingSheriffParticipantBlockReason(right,'sheriffExecutor'))) || left.meetingNumber-right.meetingNumber).map(player=>meetingPersonButton(player,'sheriffExecutor')).join('');
  }

  function renderMeetingSheriffCounterPlayerList() {
    const executor=playerName(pendingMeeting.sheriffDraft?.executor);
    $('#meetingSheriffCounterPlayerTitle').textContent=`${executor}に対抗COした参加者を選択`;
    $('#meetingSheriffCounterPlayerList').innerHTML=activePlayers().slice(0,13).sort((left,right)=>Number(Boolean(meetingSheriffParticipantBlockReason(left,'sheriffCounterPlayer')))-Number(Boolean(meetingSheriffParticipantBlockReason(right,'sheriffCounterPlayer'))) || left.meetingNumber-right.meetingNumber).map(player=>meetingPersonButton(player,'sheriffCounterPlayer')).join('');
  }

  function fillMeeting() {
    $('#alibiPeople').innerHTML = activePlayers().filter(player => player.status==='alive').map(player => `<label><input type="checkbox" value="${esc(player.id)}">${esc(player.name)}</label>`).join('');
    const players=activePlayers().slice(0,13);
    const reporters=[...players].sort((left,right)=>Number(normalizedPlayerStatus(left.status)!=='alive')-Number(normalizedPlayerStatus(right.status)!=='alive') || left.meetingNumber-right.meetingNumber);
    $('#meetingReporterList').innerHTML = reporters.map(player=>meetingPersonButton(player,'reporter')).join('');
    renderMeetingVictimList();
    renderMeetingRepairSummary();
    renderMeetingBodyDetails();
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
  const airshipMapHtml = meetingPlace => AIRSHIP_ROOMS.map(([room,key,x,y,width,height]) => `<button type="button" class="map-room" style="left:${AIRSHIP_MAP_PADDING+roomScale(x,AIRSHIP_MAP_WIDTH)}%;top:${AIRSHIP_MAP_PADDING+roomScale(y,AIRSHIP_MAP_HEIGHT)}%;width:${roomScale(width,AIRSHIP_MAP_WIDTH)}%;height:${roomScale(height,AIRSHIP_MAP_HEIGHT)}%" data-room="${esc(room)}" ${meetingPlace?'data-meeting-body-place-room=""':''} title="短縮キー：${keyLabel(key)}"><span class="room-name">${esc(room)}</span> <span class="map-key">${keyLabel(key)}</span></button>`).join('');

  $('#roomButtons').innerHTML=airshipMapHtml(false);
  $('#meetingBodyPlaceMap').innerHTML=airshipMapHtml(true);

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
    const meetingReportedBody = event.target.closest('[data-meeting-reported-body]');
    if (meetingReportedBody && !meetingReportedBody.disabled) {
      selectMeetingReportedBody(meetingReportedBody.dataset.meetingReportedBody);
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
    const meetingBodyFinder = event.target.closest('[data-meeting-body-finder]');
    if (meetingBodyFinder && !meetingBodyFinder.disabled) {
      selectMeetingBodyFinder(meetingBodyFinder.dataset.meetingBodyFinder);
      return;
    }
    const meetingBodyWitness = event.target.closest('[data-meeting-body-witness]');
    if (meetingBodyWitness && !meetingBodyWitness.disabled) {
      selectMeetingBodyWitness(meetingBodyWitness.dataset.meetingBodyWitness);
      return;
    }
    const meetingBody = event.target.closest('[data-meeting-body-index]');
    if (meetingBody) {
      showMeetingBodyFinderStep(Number(meetingBody.dataset.meetingBodyIndex));
      return;
    }
    const meetingBodyPlace = event.target.closest('[data-meeting-body-place-index]');
    if (meetingBodyPlace) {
      showMeetingBodyPlaceStep(Number(meetingBodyPlace.dataset.meetingBodyPlaceIndex));
      return;
    }
    const meetingBodyWitnesses = event.target.closest('[data-meeting-body-witness-index]');
    if (meetingBodyWitnesses) {
      showMeetingBodyWitnessStep(Number(meetingBodyWitnesses.dataset.meetingBodyWitnessIndex));
      return;
    }
    const meetingBodyExecution = event.target.closest('[data-meeting-body-execution-index]');
    if (meetingBodyExecution) {
      showMeetingSheriffExecutorStep(Number(meetingBodyExecution.dataset.meetingBodyExecutionIndex));
      return;
    }
    const meetingBodyExecutionClear = event.target.closest('[data-meeting-body-execution-clear]');
    if (meetingBodyExecutionClear) {
      const body=pendingMeeting.bodyReports[Number(meetingBodyExecutionClear.dataset.meetingBodyExecutionClear)];
      if (body) {
        clearSheriffExecution(body);
        renderMeetingBodyDetails();
      }
      return;
    }
    const meetingSheriffExecutor = event.target.closest('[data-meeting-sheriff-executor]');
    if (meetingSheriffExecutor && !meetingSheriffExecutor.disabled) {
      selectMeetingSheriffExecutor(meetingSheriffExecutor.dataset.meetingSheriffExecutor);
      return;
    }
    const meetingSheriffCounter = event.target.closest('[data-meeting-sheriff-counter]');
    if (meetingSheriffCounter) {
      selectMeetingSheriffCounterclaim(meetingSheriffCounter.dataset.meetingSheriffCounter==='yes');
      return;
    }
    const meetingSheriffCounterPlayer = event.target.closest('[data-meeting-sheriff-counter-player]');
    if (meetingSheriffCounterPlayer && !meetingSheriffCounterPlayer.disabled) {
      selectMeetingSheriffCounterPlayer(meetingSheriffCounterPlayer.dataset.meetingSheriffCounterPlayer);
      return;
    }
    const meetingBodyPlaceRoom = event.target.closest('[data-meeting-body-place-room]');
    if (meetingBodyPlaceRoom) {
      selectMeetingBodyPlace(meetingBodyPlaceRoom.dataset.room);
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
    const status = event.target.closest('[data-status][data-status-value]');
    if (status) {
      const player=activePlayers().find(candidate => candidate.id===status.dataset.status);
      if (!player) return;
      player.status=status.dataset.statusValue;
      save();
      render();
      return;
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
    const hasVictim=pendingMeeting.victims.length>0;
    $('#meetingVictimSummary').classList.toggle('hidden',!hasVictim);
    renderMeetingBodyDetails();
  }

  function showMeetingStep(id) {
    ['meetingReporterStep','meetingKillStep','meetingVictimStep','meetingReportedBodyStep','meetingRepairerStep','meetingBodyFinderStep','meetingBodyPlaceStep','meetingBodyWitnessStep','meetingSheriffExecutorStep','meetingSheriffCounterStep','meetingSheriffCounterPlayerStep','meetingDetailsStep'].forEach(stepId=>$('#'+stepId).classList.toggle('hidden',stepId!==id));
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
    if (pendingMeeting.type==='report' && pendingMeeting.victims.length===1) pendingMeeting.reportedVictim=pendingMeeting.victims[0];
    if (pendingMeeting.type==='report' && pendingMeeting.victims.length>1 && !pendingMeeting.victims.includes(pendingMeeting.reportedVictim)) return showMeetingReportedBodyStep();
    ensureMeetingBodyReports();
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
    const previousReporter=pendingMeeting.reporter;
    pendingMeeting.reporter=reporter.id;
    if (pendingMeeting.bodyReports.length) {
      for (const body of pendingMeeting.bodyReports) {
        if (!body.autoReporter && bodyReporterId(body)!==previousReporter) continue;
        const selfReport=pendingMeeting.type==='report' && reporter.id===game().me;
        body.reporter=pendingMeeting.type==='report' ? reporter.id : '';
        delete body.finder;
        body.place=selfReport ? pendingMeeting.lastLocation : '';
        body.actualPlace=body.place;
        body.witnesses=[];
        body.witnessesConfirmed=false;
        body.unknown=!body.reporter;
        body.falsified=false;
        clearSheriffExecution(body);
        body.autoReporter=Boolean(body.reporter);
      }
    }
    $('#meetingReporterName').textContent=`${reporter.name}（${meetingShortcutLabel(reporter.meetingNumber)}）`;
    continueMeetingFlow();
  }

  function selectMeetingKillOccurred(killOccurred) {
    pendingMeeting.killOccurred=killOccurred;
    if (!killOccurred) {
      pendingMeeting.victims=[];
      pendingMeeting.bodyReports=[];
      pendingMeeting.victimsConfirmed=true;
    } else {
      pendingMeeting.victimsConfirmed=false;
    }
    continueMeetingFlow();
  }

  function showMeetingVictimStep() {
    pendingMeeting.victimsConfirmed=false;
    pendingMeeting.reportedVictim='';
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
    if (pendingMeeting.type==='report' && pendingMeeting.victims.length===1) pendingMeeting.reportedVictim=pendingMeeting.victims[0];
    ensureMeetingBodyReports();
    $('#meetingVictimName').textContent=pendingMeeting.victims.map(id => {
      const victim=activePlayers().find(player=>player.id===id);
      return victim ? `${victim.name}（${meetingShortcutLabel(victim.meetingNumber)}）` : playerName(id);
    }).join('、');
    continueMeetingFlow();
  }

  function showMeetingReportedBodyStep() {
    renderMeetingReportedBodyList();
    showMeetingStep('meetingReportedBodyStep');
  }

  function selectMeetingReportedBody(id) {
    if (!pendingMeeting.victims.includes(id)) return;
    pendingMeeting.reportedVictim=id;
    ensureMeetingBodyReports();
    for (const body of pendingMeeting.bodyReports) {
      if (body.victim===id) {
        body.reporter=pendingMeeting.reporter;
        delete body.finder;
        body.place=pendingMeeting.reporter===game().me ? pendingMeeting.lastLocation : '';
        body.actualPlace=body.place;
        body.unknown=!body.reporter;
        body.autoReporter=Boolean(body.reporter);
      } else if (body.autoReporter) {
        body.reporter='';
        delete body.finder;
        body.place='';
        body.actualPlace='';
        body.witnesses=[];
        body.witnessesConfirmed=false;
        body.unknown=true;
        body.falsified=false;
        clearSheriffExecution(body);
        body.autoReporter=false;
      }
    }
    continueMeetingFlow();
  }

  function closeMeetingReportedBodyStep() {
    pendingMeeting.reportedVictim='';
    showMeetingVictimStep();
  }

  function showMeetingBodyFinderStep(index) {
    if (!pendingMeeting.bodyReports[index]) return;
    pendingMeeting.activeBodyIndex=index;
    renderMeetingBodyFinderList();
    showMeetingStep('meetingBodyFinderStep');
  }

  function closeMeetingBodyFinderStep() {
    pendingMeeting.activeBodyIndex=-1;
    renderMeetingBodyDetails();
    showMeetingStep('meetingDetailsStep');
  }

  function selectMeetingBodyFinder(id) {
    const body=activeMeetingBody();
    const reporter=activePlayers().find(player=>player.id===id);
    if (!body || !reporter) return;
    const blockReason=meetingBodyFinderBlockReason(reporter);
    if (blockReason) return toast(blockReason);
    body.reporter=reporter.id;
    delete body.finder;
    body.unknown=false;
    body.falsified=false;
    clearSheriffExecution(body);
    body.witnesses=(body.witnesses||[]).filter(playerId=>playerId!==reporter.id);
    body.place=reporter.id===game().me ? pendingMeeting.lastLocation : '';
    body.actualPlace=body.place;
    body.autoReporter=false;
    closeMeetingBodyFinderStep();
  }

  function markMeetingBodyUnknown() {
    const body=activeMeetingBody();
    if (!body) return;
    body.reporter='';
    delete body.finder;
    body.place='';
    body.actualPlace='';
    body.witnesses=[];
    body.witnessesConfirmed=false;
    body.unknown=true;
    body.falsified=false;
    clearSheriffExecution(body);
    body.autoReporter=false;
    closeMeetingBodyFinderStep();
  }

  function showMeetingBodyPlaceStep(index) {
    const body=pendingMeeting.bodyReports[index];
    if (!body || body.unknown) return;
    pendingMeeting.activeBodyIndex=index;
    $('#meetingBodyPlaceTitle').textContent=`${playerName(body.victim)}の死体発見場所を選択`;
    showMeetingStep('meetingBodyPlaceStep');
  }

  function closeMeetingBodyPlaceStep() {
    pendingMeeting.activeBodyIndex=-1;
    renderMeetingBodyDetails();
    showMeetingStep('meetingDetailsStep');
  }

  function selectMeetingBodyPlace(room) {
    const body=activeMeetingBody();
    if (!body || body.unknown || !AIRSHIP_ROOMS.some(([name])=>name===room)) return;
    body.place=room;
    if (!body.falsified) body.actualPlace=room;
    closeMeetingBodyPlaceStep();
  }

  function showMeetingBodyWitnessStep(index) {
    const body=pendingMeeting.bodyReports[index];
    if (!body || body.unknown) return;
    pendingMeeting.activeBodyIndex=index;
    pendingMeeting.bodyWitnessDraft=[...(body.witnesses||[])];
    renderMeetingBodyWitnessList();
    showMeetingStep('meetingBodyWitnessStep');
  }

  function selectMeetingBodyWitness(id) {
    const player=activePlayers().find(candidate=>candidate.id===id);
    if (!player) return;
    const blockReason=meetingBodyWitnessBlockReason(player);
    if (blockReason) return toast(blockReason);
    const selectedIndex=pendingMeeting.bodyWitnessDraft.indexOf(player.id);
    if (selectedIndex===-1) pendingMeeting.bodyWitnessDraft.push(player.id);
    else pendingMeeting.bodyWitnessDraft.splice(selectedIndex,1);
    renderMeetingBodyWitnessList();
  }

  function closeMeetingBodyWitnessStep() {
    pendingMeeting.activeBodyIndex=-1;
    pendingMeeting.bodyWitnessDraft=[];
    renderMeetingBodyDetails();
    showMeetingStep('meetingDetailsStep');
  }

  function confirmMeetingBodyWitnesses() {
    const body=activeMeetingBody();
    if (!body) return;
    body.witnesses=[...pendingMeeting.bodyWitnessDraft];
    body.witnessesConfirmed=true;
    closeMeetingBodyWitnessStep();
  }

  function showMeetingSheriffExecutorStep(index) {
    const body=pendingMeeting.bodyReports[index];
    if (!body || body.unknown) return;
    pendingMeeting.activeBodyIndex=index;
    pendingMeeting.sheriffDraft={
      executor:bodySheriffExecutorId(body),
      counterclaim:Boolean(body.sheriffCounterclaim),
      counterPlayer:body.sheriffCounterPlayer||''
    };
    renderMeetingSheriffExecutorList();
    showMeetingStep('meetingSheriffExecutorStep');
  }

  function selectMeetingSheriffExecutor(id) {
    const player=activePlayers().find(candidate=>candidate.id===id);
    if (!player || !pendingMeeting.sheriffDraft) return;
    const blockReason=meetingSheriffParticipantBlockReason(player,'sheriffExecutor');
    if (blockReason) return toast(blockReason);
    pendingMeeting.sheriffDraft.executor=player.id;
    pendingMeeting.sheriffDraft.counterclaim=null;
    pendingMeeting.sheriffDraft.counterPlayer='';
    showMeetingStep('meetingSheriffCounterStep');
  }

  function selectMeetingSheriffCounterclaim(hasCounterclaim) {
    if (!pendingMeeting.sheriffDraft?.executor) return;
    pendingMeeting.sheriffDraft.counterclaim=hasCounterclaim;
    pendingMeeting.sheriffDraft.counterPlayer='';
    if (hasCounterclaim) {
      renderMeetingSheriffCounterPlayerList();
      showMeetingStep('meetingSheriffCounterPlayerStep');
    } else commitMeetingSheriffExecution();
  }

  function selectMeetingSheriffCounterPlayer(id) {
    const player=activePlayers().find(candidate=>candidate.id===id);
    if (!player || !pendingMeeting.sheriffDraft) return;
    const blockReason=meetingSheriffParticipantBlockReason(player,'sheriffCounterPlayer');
    if (blockReason) return toast(blockReason);
    pendingMeeting.sheriffDraft.counterPlayer=player.id;
    commitMeetingSheriffExecution();
  }

  function commitMeetingSheriffExecution() {
    const body=activeMeetingBody();
    const draft=pendingMeeting.sheriffDraft;
    if (!body || !draft?.executor || (draft.counterclaim && !draft.counterPlayer)) return;
    body.sheriffExecution=true;
    body.sheriffExecutor=draft.executor;
    body.sheriffCounterclaim=Boolean(draft.counterclaim);
    body.sheriffCounterPlayer=draft.counterclaim ? draft.counterPlayer : '';
    closeMeetingSheriffFlow();
  }

  function closeMeetingSheriffFlow() {
    pendingMeeting.activeBodyIndex=-1;
    pendingMeeting.sheriffDraft=null;
    renderMeetingBodyDetails();
    showMeetingStep('meetingDetailsStep');
  }

  function backToMeetingSheriffCounterStep() {
    if (!pendingMeeting.sheriffDraft?.executor) return closeMeetingSheriffFlow();
    pendingMeeting.sheriffDraft.counterPlayer='';
    showMeetingStep('meetingSheriffCounterStep');
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
    const lastLocation=lastRoomInPath(game().path);
    commitTurn();
    pendingMeeting={type,reporter:'',killOccurred:type==='report'?true:null,victims:[],victimsConfirmed:false,reportedVictim:'',repairs,activeRepairIndex:-1,repairDraft:[],bodyReports:[],activeBodyIndex:-1,bodyWitnessDraft:[],sheriffDraft:null,lastLocation};
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
      const choosingReportedBody=!$('#meetingReportedBodyStep').classList.contains('hidden');
      const choosingRepairer=!$('#meetingRepairerStep').classList.contains('hidden');
      const choosingBodyFinder=!$('#meetingBodyFinderStep').classList.contains('hidden');
      const choosingBodyPlace=!$('#meetingBodyPlaceStep').classList.contains('hidden');
      const choosingBodyWitness=!$('#meetingBodyWitnessStep').classList.contains('hidden');
      const choosingSheriffExecutor=!$('#meetingSheriffExecutorStep').classList.contains('hidden');
      const choosingSheriffCounter=!$('#meetingSheriffCounterStep').classList.contains('hidden');
      const choosingSheriffCounterPlayer=!$('#meetingSheriffCounterPlayerStep').classList.contains('hidden');
      if (choosingBodyPlace && !event.altKey && !event.ctrlKey && !event.metaKey) {
        const room=AIRSHIP_ROOMS.find(([,key])=>key===event.key);
        if (room) {
          selectMeetingBodyPlace(room[0]);
          event.preventDefault();
          return;
        }
      }
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
      if (choosingBodyWitness && event.metaKey && event.key==='Enter' && !event.shiftKey && !event.altKey && !event.ctrlKey) {
        confirmMeetingBodyWitnesses();
        event.preventDefault();
        return;
      }
      if (choosingKill && !event.shiftKey && !event.altKey && !event.ctrlKey && !event.metaKey && (event.code==='Digit1' || event.code==='Digit2')) {
        selectMeetingKillOccurred(event.code==='Digit1');
        event.preventDefault();
        return;
      }
      if (choosingSheriffCounter && !event.shiftKey && !event.altKey && !event.ctrlKey && !event.metaKey && (event.code==='Digit1' || event.code==='Digit2')) {
        selectMeetingSheriffCounterclaim(event.code==='Digit1');
        event.preventDefault();
        return;
      }
      if (choosingReporter || choosingVictim || choosingReportedBody || choosingRepairer || choosingBodyFinder || choosingBodyWitness || choosingSheriffExecutor || choosingSheriffCounterPlayer) {
        const number=meetingNumberFromShortcut(event);
        const player=activePlayers().find(candidate=>candidate.meetingNumber===number);
        if (player) {
          if (choosingReporter) {
            const blockReason=meetingReporterBlockReason(player);
            if (blockReason) toast(blockReason);
            else selectMeetingReporter(player.id);
          } else if (choosingVictim && unavailableVictim(player)) {
            toast(`${player.name}はすでに${playerStatusLabel(player.status)}扱いです`);
          } else if (choosingVictim) selectMeetingVictim(player.id);
          else if (choosingReportedBody) {
            if (!pendingMeeting.victims.includes(player.id)) toast(`${player.name}は今回の死亡者ではありません`);
            else selectMeetingReportedBody(player.id);
          }
          else if (choosingRepairer) selectMeetingRepairer(player.id);
          else if (choosingBodyFinder) {
            const blockReason=meetingBodyFinderBlockReason(player);
            if (blockReason) toast(blockReason);
            else selectMeetingBodyFinder(player.id);
          } else if (choosingBodyWitness) {
            const blockReason=meetingBodyWitnessBlockReason(player);
            if (blockReason) toast(blockReason);
            else selectMeetingBodyWitness(player.id);
          } else if (choosingSheriffExecutor) {
            const blockReason=meetingSheriffParticipantBlockReason(player,'sheriffExecutor');
            if (blockReason) toast(blockReason);
            else selectMeetingSheriffExecutor(player.id);
          } else {
            const blockReason=meetingSheriffParticipantBlockReason(player,'sheriffCounterPlayer');
            if (blockReason) toast(blockReason);
            else selectMeetingSheriffCounterPlayer(player.id);
          }
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
  $('#cancelMeetingReportedBody').onclick = closeMeetingReportedBodyStep;
  $('#confirmMeetingRepairers').onclick = confirmMeetingRepairers;
  $('#cancelMeetingRepairers').onclick = closeMeetingRepairerStep;
  $('#markMeetingBodyUnknown').onclick = markMeetingBodyUnknown;
  $('#cancelMeetingBodyFinder').onclick = closeMeetingBodyFinderStep;
  $('#cancelMeetingBodyPlace').onclick = closeMeetingBodyPlaceStep;
  $('#confirmMeetingBodyWitnesses').onclick = confirmMeetingBodyWitnesses;
  $('#cancelMeetingBodyWitnesses').onclick = closeMeetingBodyWitnessStep;
  $('#cancelMeetingSheriffExecutor').onclick = closeMeetingSheriffFlow;
  $('#cancelMeetingSheriffCounter').onclick = closeMeetingSheriffFlow;
  $('#cancelMeetingSheriffCounterPlayer').onclick = backToMeetingSheriffCounterStep;
  $('#meetingBodyRecords').addEventListener('change',event=>{
    const fake=event.target.closest('[data-meeting-body-fake]');
    if (fake) {
      const index=Number(fake.dataset.meetingBodyFake);
      const body=pendingMeeting.bodyReports[index];
      if (!body) return;
      body.falsified=fake.checked;
      if (fake.checked) {
        body.actualPlace=body.actualPlace||body.place||pendingMeeting.lastLocation;
        body.place='';
      } else body.place=body.actualPlace||pendingMeeting.lastLocation;
      renderMeetingBodyDetails();
      if (fake.checked) showMeetingBodyPlaceStep(index);
      return;
    }
  });
  $('#saveMeeting').onclick = () => {
    const type=pendingMeeting.type, reporter=pendingMeeting.reporter;
    const victims=[...pendingMeeting.victims];
    const killOccurred=type==='report' || pendingMeeting.killOccurred===true;
    if (!reporter) return toast('起票者を選択してください');
    if (type==='button' && pendingMeeting.killOccurred===null) return toast('キル発生の有無を選択してください');
    if (killOccurred && (!pendingMeeting.victimsConfirmed || !victims.length)) return toast('死亡者を選択して確定してください');
    ensureMeetingBodyReports();
    const invalidBody=killOccurred ? pendingMeeting.bodyReports.find(body=>!body.unknown && (!bodyReporterId(body) || !body.place.trim())) : null;
    if (invalidBody) return toast(`${playerName(invalidBody.victim)}の通報者と発見場所を入力してください`);
    const invalidExecution=killOccurred ? pendingMeeting.bodyReports.find(body=>body.sheriffExecution && (!bodySheriffExecutorId(body) || (body.sheriffCounterclaim && !body.sheriffCounterPlayer))) : null;
    if (invalidExecution) return toast(`${playerName(invalidExecution.victim)}のシェリフ執行情報を入力し直してください`);
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
    const bodyReports=killOccurred ? pendingMeeting.bodyReports.map(body=>({victim:body.victim,reporter:bodyReporterId(body),place:body.place,actualPlace:body.actualPlace,witnesses:[...(body.witnesses||[])],witnessesConfirmed:Boolean(body.witnessesConfirmed),unknown:body.unknown,falsified:body.falsified,sheriffExecution:Boolean(body.sheriffExecution),sheriffExecutor:bodySheriffExecutorId(body),sheriffCounterclaim:Boolean(body.sheriffCounterclaim),sheriffCounterPlayer:body.sheriffCounterPlayer||''})) : [];
    const meeting={kind:'meeting',turn:game().turn,type,reporter,killOccurred,victims:killOccurred?victims:[],victim:killOccurred?(victims[0]||''):'',bodyReports,bodyPlace:bodyReports.find(body=>body.place)?.place||'',witness:$('#witness').value.trim(),note:$('#meetingNote').value.trim(),result:$('#meetingResult').value.trim(),alibis,repairs};
    game().timeline.push(meeting);
    if (killOccurred) {
      for (const body of bodyReports) {
        const player=activePlayers().find(candidate=>candidate.id===body.victim);
        if (player) player.status=body.sheriffExecution?'executed':'dead';
        if (body.sheriffExecution && !body.sheriffCounterclaim && body.sheriffExecutor) {
          const sheriffExecutor=activePlayers().find(candidate=>candidate.id===body.sheriffExecutor);
          if (sheriffExecutor && sheriffExecutor.specialStatus!=='sheriff') sheriffExecutor.specialStatus='sheriff';
        }
        game().deaths.push({...meeting,...body});
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
      : `[会議 T${item.turn}] ${item.type==='button'?'ボタン':'通報'}: ${playerName(item.reporter)}${meetingVictimIds(item).length?` / 死体: ${meetingBodiesText(item)}`:''}\n視認: ${item.witness||'—'} / 結果: ${item.result||'—'}${item.alibis?.length?`\nキル不可: ${item.alibis.map(alibi=>`${playerName(alibi.player)}（${alibi.reason||'理由なし'}）`).join('、')}`:''}`)];
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
