(() => {
  const STORAGE_KEY = 'among-memo-v1';
  const $ = selector => document.querySelector(selector);
  const esc = value => String(value || '').replace(/[&<>"']/g, character => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[character]));
  let state = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null') || { members: [], game: { me:'', role:'クルー', participants:[], turn:1, path:[], seen:'', note:'', timeline:[], sabotages:[], deaths:[] } };
  const game = () => state.game;

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

  function activePlayers() { return game().participants.filter(player => player.active); }

  function playerOptions(selected='', includeEmpty=true) {
    return `${includeEmpty ? '<option value="">選択…</option>' : ''}${activePlayers().map(player => `<option value="${esc(player.id)}" ${player.id===selected?'selected':''}>${esc(player.name)}</option>`).join('')}`;
  }

  function playerName(id) {
    return activePlayers().find(player => player.id===id)?.name || state.members.find(player => player.id===id)?.name || '—';
  }

  function render() {
    $('#me').innerHTML = playerOptions(game().me);
    $('#role').value = game().role;
    $('#turnLabel').textContent = `T${game().turn}`;
    $('#players').innerHTML = activePlayers().length
      ? activePlayers().map(player => `<div class="player"><span>${esc(player.name)}</span><select data-status="${esc(player.id)}"><option value="alive" ${player.status==='alive'?'selected':''}>生存</option><option value="dead" ${player.status==='dead'?'selected':''}>死亡</option><option value="ejected" ${player.status==='ejected'?'selected':''}>追放</option></select></div>`).join('')
      : '<p class="empty">メンバー管理から参加者を登録してください。</p>';
    $('#path').innerHTML = game().path.length
      ? game().path.map((room,index) => `<span class="room ${room.startsWith('⚡')?'repair':''}">${esc(room)} <button data-remove-path="${index}" title="削除">×</button></span>`).join(' → ')
      : '<span class="meta">移動先を追加</span>';
    $('#seen').value = game().seen;
    $('#turnNote').value = game().note;
    $('#timeline').innerHTML = game().timeline.length
      ? [...game().timeline].reverse().map(item => item.kind==='turn'
        ? `<article class="card"><h3>T${item.turn} <span class="pill">行動</span></h3><div class="detail"><b>経路：</b>${esc(item.path.join(' → ') || '—')}<br><b>視認：</b>${esc(item.seen || '—')}<br><b>メモ：</b>${esc(item.note || '—')}</div></article>`
        : `<article class="card meeting"><h3>会議 ${item.type==='button'?'緊急ボタン':'死体通報'} <span class="pill">T${item.turn}</span></h3><div class="detail"><b>起票：</b>${esc(playerName(item.reporter))}${item.victim?`　<b>死亡：</b>${esc(playerName(item.victim))} @ ${esc(item.bodyPlace||'不明')}`:''}<br><b>視認：</b>${esc(item.witness||'—')}<br><b>結果：</b>${esc(item.result||'—')}<br><b>メモ：</b>${esc(item.note||'—')}</div>${item.alibis?.length?`<div class="tags">${item.alibis.map(alibi=>`<span class="tag">${esc(playerName(alibi.player))}：${esc(alibi.reason||'白根拠')}</span>`).join('')}</div>`:''}</article>`).join('')
      : '<p class="empty">まだ記録はありません。</p>';
    $('#saboLog').innerHTML = game().sabotages.length
      ? [...game().sabotages].reverse().map(sabotage => `<article class="card"><h3>T${sabotage.turn} ${esc(sabotage.type)}</h3><div class="detail"><b>修理：</b>${esc(playerName(sabotage.fixer))}${sabotage.place?` @ ${esc(sabotage.place)}`:''}${sabotage.note?`<br>${esc(sabotage.note)}`:''}</div></article>`).join('')
      : '<p class="empty">修理記録はありません。</p>';
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

  function fillMeeting() {
    ['reporter','victim'].forEach(id => $('#'+id).innerHTML=playerOptions());
    $('#alibiPeople').innerHTML = activePlayers().filter(player => player.status==='alive').map(player => `<label><input type="checkbox" value="${esc(player.id)}">${esc(player.name)}</label>`).join('');
  }

  function createId(name) { return `${Date.now()}-${Math.random().toString(36).slice(2,7)}-${name}`; }
  const keyLabel = key => key && key===key.toUpperCase() ? `⇧${key.toLowerCase()}` : key;
  const roomScale = (value, maximum) => value / maximum * (100 - AIRSHIP_MAP_PADDING * 2);

  $('#roomButtons').innerHTML = AIRSHIP_ROOMS.map(([room,key,x,y,width,height]) => `<button class="map-room" style="left:${AIRSHIP_MAP_PADDING+roomScale(x,AIRSHIP_MAP_WIDTH)}%;top:${AIRSHIP_MAP_PADDING+roomScale(y,AIRSHIP_MAP_HEIGHT)}%;width:${roomScale(width,AIRSHIP_MAP_WIDTH)}%;height:${roomScale(height,AIRSHIP_MAP_HEIGHT)}%" data-room="${esc(room)}" title="短縮キー：${keyLabel(key)}"><span class="room-name">${esc(room)}</span> <span class="map-key">${keyLabel(key)}</span></button>`).join('');

  const repairLabels = {'停電':'⚡ 停電を修理','通信':'⚡ コミュニケーションを修理','原子炉':'⚡ リアクターを修理'};
  const repairTypeForLabel = label => Object.keys(repairLabels).find(type => repairLabels[type]===label);

  function removePathAt(index) {
    const removed = game().path.splice(index,1)[0];
    const type = repairTypeForLabel(removed);
    if (!type) return;
    for (let index=game().sabotages.length-1; index>=0; index--) {
      const sabotage = game().sabotages[index];
      if (sabotage.turn===game().turn && sabotage.type===type && sabotage.fixer===game().me) {
        game().sabotages.splice(index,1);
        break;
      }
    }
  }

  function recordRepair(type,fixer,place='',note='') {
    game().sabotages.push({turn:game().turn,type,fixer,place,note});
    if (fixer===game().me) game().path.push(repairLabels[type] || `⚡ ${type}を修理`);
  }

  document.addEventListener('click', event => {
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

  function quickRepair(type) {
    if (!game().me) return toast('先に「自分の名前」を選択してください');
    recordRepair(type,game().me,'','ショートカット記録');
    save();
    render();
    toast(`${repairLabels[type].replace('⚡ ','')}を経路に追加しました`);
  }

  document.addEventListener('keydown', event => {
    if (event.target.matches('input,textarea,select') || document.querySelector('dialog[open]')) return;
    if (event.key==='Backspace') {
      if (game().path.length) removePathAt(game().path.length-1);
      save();
      render();
      event.preventDefault();
      return;
    }
    const repairs = {'1':'停電','2':'通信','3':'原子炉'};
    if (repairs[event.key]) {
      quickRepair(repairs[event.key]);
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

  $('#me').onchange = event => { game().me=event.target.value; save(); };
  $('#role').onchange = event => { game().role=event.target.value; save(); };
  $('#seen').oninput = event => { game().seen=event.target.value; save(); };
  $('#turnNote').oninput = event => { game().note=event.target.value; save(); };
  $('#finishTurn').onclick = nextTurn;
  $('#openMeeting').onclick = () => { commitTurn(); fillMeeting(); $('#meetingDialog').showModal(); };
  $('#addSabo').onclick = () => { $('#saboFixer').innerHTML=playerOptions(); openDialog('#saboDialog'); };
  $('#saveSabo').onclick = () => {
    const fixer=$('#saboFixer').value, type=$('#saboType').value;
    if (!fixer) return toast('修理者を選択してください');
    recordRepair(type,fixer,$('#saboPlace').value.trim(),$('#saboNote').value.trim());
    $('#saboDialog').close();
    save();
    render();
    toast(fixer===game().me?'修理を経路に追加しました':'修理を記録しました');
  };
  $('#meetingType').onchange = () => {
    const report=$('#meetingType').value==='report';
    $('#victimWrap').classList.toggle('hidden',!report);
    $('#bodyPlaceWrap').classList.toggle('hidden',!report);
  };
  $('#saveMeeting').onclick = () => {
    const type=$('#meetingType').value, reporter=$('#reporter').value, victim=$('#victim').value;
    if (!reporter) return toast('起票者を選択してください');
    if (type==='report'&&!victim) return toast('死亡者を選択してください');
    const ids=[...$('#alibiPeople').querySelectorAll(':checked')].map(element=>element.value);
    const reason=$('#alibiReason').value.trim();
    const alibis=ids.map(player=>({player,reason}));
    const meeting={kind:'meeting',turn:game().turn,type,reporter,victim:type==='report'?victim:'',bodyPlace:$('#bodyPlace').value.trim(),witness:$('#witness').value.trim(),note:$('#meetingNote').value.trim(),result:$('#meetingResult').value.trim(),alibis};
    game().timeline.push(meeting);
    if (type==='report') {
      const player=activePlayers().find(player=>player.id===victim);
      if (player) player.status='dead';
      game().deaths.push({...meeting});
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
      ? state.members.map(member=>`<div class="row card"><span class="grow">${esc(member.name)}</span><label><input type="checkbox" data-member-active="${esc(member.id)}" ${activePlayers().some(player=>player.id===member.id)?'checked':''}> 今回参加</label><button class="danger small" data-delete-member="${esc(member.id)}">削除</button></div>`).join('')
      : '<p class="empty">メンバーがいません。</p>';
  }
  $('#addMember').onclick = () => {
    const name=$('#newMemberName').value.trim();
    if (!name) return;
    const member={id:createId('member'),name};
    state.members.push(member);
    game().participants.push({...member,active:true,status:'alive'});
    $('#newMemberName').value='';
    save();
    renderMemberList();
    render();
  };
  $('#memberList').onclick = event => {
    const button=event.target.closest('[data-delete-member]');
    if (!button) return;
    const id=button.dataset.deleteMember;
    state.members=state.members.filter(member=>member.id!==id);
    game().participants=game().participants.filter(member=>member.id!==id);
    if (game().me===id) game().me='';
    save();
    renderMemberList();
    render();
  };
  $('#memberList').onchange = event => {
    const checkbox=event.target.closest('[data-member-active]');
    if (!checkbox) return;
    const id=checkbox.dataset.memberActive;
    const participant=game().participants.find(player=>player.id===id);
    if (checkbox.checked&&!participant) {
      const member=state.members.find(member=>member.id===id);
      game().participants.push({...member,active:true,status:'alive'});
    }
    if (!checkbox.checked&&participant) game().participants=game().participants.filter(player=>player.id!==id);
    save();
    render();
  };

  document.querySelectorAll('.closeDialog').forEach(button => button.onclick=()=>button.closest('dialog').close());
  $('#newGame').onclick = () => {
    if (!confirm('現在の試合ログを消去して新規ゲームを開始しますか？ メンバー一覧は残ります。')) return;
    state.game={me:'',role:'クルー',participants:state.members.map(member=>({...member,active:true,status:'alive'})),turn:1,path:[],seen:'',note:'',timeline:[],sabotages:[],deaths:[]};
    save();
    render();
    toast('新規ゲームを開始しました');
  };
  $('#exportMembers').onclick = () => {
    const blob=new Blob([JSON.stringify({members:state.members},null,2)],{type:'application/json'}), link=document.createElement('a');
    link.href=URL.createObjectURL(blob);
    link.download='among-members.json';
    link.click();
    URL.revokeObjectURL(link.href);
    toast('メンバーJSONを保存しました');
  };
  $('#importMembers').onclick = () => $('#memberFile').click();
  $('#memberFile').onchange = async event => {
    const file=event.target.files[0];
    if (!file) return;
    try {
      const data=JSON.parse(await file.text());
      if (!Array.isArray(data.members)) throw Error();
      state.members=data.members.filter(member=>member&&member.name).map(member=>({id:member.id||createId('member'),name:String(member.name)}));
      game().participants=state.members.map(member=>({...member,active:true,status:'alive'}));
      game().me='';
      save();
      render();
      toast(`${state.members.length}名を読み込みました`);
    } catch {
      toast('正しいメンバーJSONではありません');
    }
    event.target.value='';
  };
  $('#copyLog').onclick = async () => {
    const lines=[`Among Memo / ${game().role}`,`自分: ${playerName(game().me)}`,'',...game().timeline.map(item=>item.kind==='turn'
      ? `[T${item.turn}] 経路: ${item.path.join(' → ')||'—'} / 視認: ${item.seen||'—'} / ${item.note||''}`
      : `[会議 T${item.turn}] ${item.type==='button'?'ボタン':'通報'}: ${playerName(item.reporter)}${item.victim?` / 死亡: ${playerName(item.victim)} @ ${item.bodyPlace||'不明'}`:''}\n視認: ${item.witness||'—'} / 結果: ${item.result||'—'}${item.alibis?.length?`\nキル不可: ${item.alibis.map(alibi=>`${playerName(alibi.player)}（${alibi.reason||'理由なし'}）`).join('、')}`:''}`)];
    try {
      await navigator.clipboard.writeText(lines.join('\n'));
      toast('試合ログをコピーしました');
    } catch {
      toast('コピーできませんでした');
    }
  };

  render();
})();
