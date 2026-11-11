(function () {
'use strict';

var R = window.RUBRICS, ROLES = window.ROLES, N_TEAMS = 17;
var CAS_KEYS = ['cas1', 'cas2', 'cas3'];
var BREATH_ITEM = 't_nogive'; // מתאפס אצל מפקד הסטריפ אם הפצוע הרביעי הוזנח
var app = document.getElementById('app');

/* ───────── helpers ───────── */
function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
  });
}
function fmt(n) { return String(Math.round(n * 100) / 100); }
function clean(o) { return JSON.parse(JSON.stringify(o)); }
function codeKey(s) { return String(s || '').trim().replace(/[.#$\/\[\]\s]/g, ''); }
var LS = {
  get: function (k, d) { try { var v = localStorage.getItem('tj_' + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
  set: function (k, v) { try { localStorage.setItem('tj_' + k, JSON.stringify(v)); } catch (e) {} },
  del: function (k) { try { localStorage.removeItem('tj_' + k); } catch (e) {} }
};
var DEV = LS.get('dev');
if (!DEV) { DEV = Math.random().toString(36).slice(2, 10); LS.set('dev', DEV); }

function setPath(obj, path, val) {
  var ks = path.split('/'), o = obj;
  for (var i = 0; i < ks.length - 1; i++) {
    if (o[ks[i]] == null || typeof o[ks[i]] !== 'object') o[ks[i]] = {};
    o = o[ks[i]];
  }
  if (val === null) delete o[ks[ks.length - 1]]; else o[ks[ks.length - 1]] = val;
}
var toastT;
function toast(msg) {
  var t = document.getElementById('toast');
  t.textContent = msg; t.classList.add('show');
  clearTimeout(toastT); toastT = setTimeout(function () { t.classList.remove('show'); }, 2600);
}
/* אישור בשתי לחיצות במקום חלון קופץ */
function arm(b, label) {
  if (b.dataset.armed) return true;
  b.dataset.armed = '1'; b.dataset.orig = b.textContent; b.textContent = label; b.classList.add('armed');
  setTimeout(function () {
    if (b.isConnected && b.dataset.armed) { delete b.dataset.armed; b.textContent = b.dataset.orig; b.classList.remove('armed'); }
  }, 4000);
  return false;
}

var ITEMS = {}; // rubric -> itemId -> {it, cat}
Object.keys(R).forEach(function (rk) {
  ITEMS[rk] = {};
  R[rk].cats.forEach(function (c) { c.items.forEach(function (it) { ITEMS[rk][it.id] = { it: it, cat: c }; }); });
});
function roleOf(key) { for (var i = 0; i < ROLES.length; i++) if (ROLES[i].key === key) return ROLES[i]; return null; }
function teamIds() { var a = []; for (var i = 1; i <= N_TEAMS; i++) a.push('t' + i); return a; }
function teamName(tid) {
  var m = (Store.data.meta || {}).teams || {};
  return m[tid] || ('תאג"ד ' + tid.slice(1));
}

/* ───────── store: Firebase Realtime DB, או localStorage במצב הדגמה ───────── */
var fbLoad = null;
function loadScript(src) {
  return new Promise(function (res, rej) {
    var s = document.createElement('script'); s.src = src; s.onload = res; s.onerror = rej; document.head.appendChild(s);
  });
}
function loadFirebase() {
  if (!fbLoad) {
    var v = 'https://www.gstatic.com/firebasejs/10.12.2/';
    fbLoad = loadScript(v + 'firebase-app-compat.js')
      .then(function () { return loadScript(v + 'firebase-database-compat.js'); })
      .then(function () { if (!firebase.apps.length) firebase.initializeApp(window.FIREBASE_CONFIG); });
    fbLoad.catch(function () { fbLoad = null; });
  }
  return fbLoad;
}

var Store = {
  demo: !window.FIREBASE_CONFIG, code: null, data: {}, online: false, pending: {}, ref: null, conRef: null,

  connect: function (code) {
    var self = this;
    this.disconnect();
    this.code = code;
    if (this.demo) { this.data = LS.get('demo_' + code, {}); this.online = true; return Promise.resolve(); }
    this.pending = LS.get('pend_' + code, {});
    this.data = LS.get('cache_' + code, {});
    this.applyPending();
    return loadFirebase().then(function () {
      return new Promise(function (res) {
        var done = false;
        function fin() { if (!done) { done = true; res(); } }
        self.ref = firebase.database().ref('c/' + code);
        self.ref.on('value', function (s) {
          self.data = s.val() || {};
          self.applyPending();
          LS.set('cache_' + code, self.data);
          fin(); onData();
        }, function () { toast('אין גישה לנתונים – בדוק את הגדרות Firebase'); fin(); });
        self.conRef = firebase.database().ref('.info/connected');
        self.conRef.on('value', function (s) {
          self.online = !!s.val();
          if (self.online) self.flush();
          syncDot();
        });
        setTimeout(fin, 6000);
      });
    }, function () { /* אין רשת לטעינת ה-SDK: ממשיכים מהמטמון, נשמר מקומית */ });
  },
  disconnect: function () {
    if (this.ref) this.ref.off();
    if (this.conRef) this.conRef.off();
    this.ref = this.conRef = null; this.code = null; this.data = {}; this.pending = {}; this.online = false;
  },
  applyPending: function () {
    for (var p in this.pending) setPath(this.data, p, this.pending[p]);
  },
  write: function (path, val) {
    val = val == null ? null : clean(val);
    setPath(this.data, path, val);
    if (this.demo) { LS.set('demo_' + this.code, this.data); onData(); return; }
    this.pending[path] = val; LS.set('pend_' + this.code, this.pending);
    LS.set('cache_' + this.code, this.data);
    this.push(path);
    onData();
  },
  push: function (path) {
    var self = this, val = this.pending[path], sent = JSON.stringify(val);
    if (!this.ref) return;
    this.ref.child(path).set(val).then(function () {
      if (path in self.pending && JSON.stringify(self.pending[path]) === sent) {
        delete self.pending[path]; LS.set('pend_' + self.code, self.pending);
      }
      syncDot();
    }).catch(function () {});
  },
  flush: function () { for (var p in this.pending) this.push(p); },
  hasPending: function () { for (var p in this.pending) return true; return false; }
};
window.addEventListener('storage', function (e) {
  if (Store.demo && Store.code && e.key === 'tj_demo_' + Store.code) { Store.data = LS.get('demo_' + Store.code, {}); onData(); }
});
window.addEventListener('online', function () { if (!Store.demo && Store.code && !Store.ref) location.reload(); });

function syncHtml() {
  if (Store.demo) return '<span class="sync" id="sync">הדגמה</span>';
  var ok = Store.online && !Store.hasPending();
  return '<span class="sync ' + (ok ? 'ok' : 'off') + '" id="sync">' + (ok ? 'מסונכרן' : 'לא מסונכרן · נשמר במכשיר') + '</span>';
}
function syncDot() { var el = document.getElementById('sync'); if (el) el.outerHTML = syncHtml(); }

/* ───────── ניקוד ───────── */
function itemScore(it, a, zero) {
  var v = a ? a[it.id] : undefined;
  switch (it.t) {
    case 'check': return (zero && zero[it.id]) ? 0 : (v ? it.pts : 0);
    case 'tri': return v === 'full' ? it.pts : v === 'part' ? it.partial : 0;
    case 'count': return Math.min(it.max, Number(v) || 0);
    case 'penalty': return v ? -it.pts : 0;
    case 'time': return v == null ? 0 : it.opts[v].pts;
    default: return 0;
  }
}
function scoreSheet(rk, a, zero) {
  var total = 0, cats = {};
  R[rk].cats.forEach(function (c) {
    var s = 0;
    c.items.forEach(function (it) { s += itemScore(it, a, zero); });
    s = Math.max(0, s); cats[c.id] = s; total += s;
  });
  return { total: total, cats: cats };
}
function getSheet(t, r) { return ((Store.data.sheets || {})[t] || {})[r] || null; }
function getBreath(t) { return ((Store.data.extra || {})[t] || {}).breath || null; }

/* חישוב רוחבי: סעיף מזכה רק אם כל הבוחנים שהסעיף רלוונטי אצלם סימנו "בוצע" */
function casCalc(tid) {
  var sheets = CAS_KEYS.map(function (k) { return getSheet(tid, k); });
  var n = sheets.filter(Boolean).length;
  var total = 0, items = {}, cats = {};
  R.cas.cats.forEach(function (c) {
    var cs = 0;
    c.items.forEach(function (it) {
      var vals = sheets.map(function (s) { return s ? ((s.a || {})[it.id] || null) : null; });
      var answered = vals.filter(Boolean);
      var fail = vals.indexOf('n') >= 0;
      var pts = (!fail && answered.length > 0) ? it.pts : 0;
      items[it.id] = { vals: vals, pts: pts, fail: fail, pending: !fail && answered.length < 3 };
      cs += pts;
    });
    cats[c.id] = cs; total += cs;
  });
  return { n: n, total: n ? total : null, items: items, cats: cats };
}
function teamCalc(tid) {
  var br = getBreath(tid);
  var zero = br && br.v === 'n' ? {} : null;
  if (zero) zero[BREATH_ITEM] = true;
  var sh = {};
  ROLES.forEach(function (r) { sh[r.key] = getSheet(tid, r.key); });
  var mtb = sh.mtb ? scoreSheet('mtb', sh.mtb.a || {}).total : null;
  var comms = sh.comms ? scoreSheet('comms', sh.comms.a || {}).total : null;
  var strip = sh.strip ? scoreSheet('strip', sh.strip.a || {}, zero).total : null;
  var cas = casCalc(tid);
  var subs = ROLES.filter(function (r) { return sh[r.key] && sh[r.key].sub; }).length;
  var started = ROLES.filter(function (r) { return sh[r.key]; }).length;
  var timeIdx = sh.strip && sh.strip.a ? sh.strip.a.time : null;
  return {
    tid: tid, mtb: mtb, cas: cas.total, comms: comms, strip: strip, casDetail: cas,
    total: (mtb || 0) + (cas.total || 0) + (comms || 0) + (strip || 0),
    subs: subs, started: started, breath: br, zero: zero,
    timePts: timeIdx == null ? -1 : ITEMS.strip.time.it.opts[timeIdx].pts,
    final: subs === 6 && !!br
  };
}
function ranking() {
  var rows = teamIds().map(teamCalc);
  rows.sort(function (x, y) {
    if ((x.started > 0) !== (y.started > 0)) return x.started > 0 ? -1 : 1;
    if (y.total !== x.total) return y.total - x.total;
    if (y.timePts !== x.timePts) return y.timePts - x.timePts;
    return Number(x.tid.slice(1)) - Number(y.tid.slice(1));
  });
  return rows;
}

/* ───────── state ───────── */
var S = { screen: 'home', sess: null, role: null, err: '', detail: null };
var cur = null; // הדף הפתוח: {team, role, rk, sheet, seen, other}

function go(screen) { S.screen = screen; S.err = ''; render(); window.scrollTo(0, 0); }
function render() {
  ({ home: renderHome, jlogin: renderJLogin, alogin: renderALogin, teams: renderTeams, sheet: renderSheet,
     dash: renderDash, detail: renderDetail, names: renderNames })[S.screen]();
}
function onData() {
  if (S.screen === 'teams' || S.screen === 'dash' || S.screen === 'detail') render();
  else if (S.screen === 'sheet') sheetRemote();
  syncDot();
}

/* ───────── מסכי כניסה ───────── */
function renderHome() {
  app.innerHTML = '<div class="wrap home"><h1>שיפוט תחרות תאג"דים</h1><p>מילוי צ\'קליסט בוחן וריכוז ציונים</p>' +
    '<button class="big primary" data-act="nav" data-to="jlogin">כניסת בוחן</button>' +
    '<button class="big" data-act="nav" data-to="alogin">ריכוז ציונים (מנהל תחרות)</button>' +
    (Store.demo ? '<div class="demo">מצב הדגמה: Firebase עדיין לא הוגדר, הנתונים נשמרים רק במכשיר הזה.</div>' : '') +
    '</div>';
}
function renderJLogin() {
  var last = LS.get('last', {});
  if (S.role == null) S.role = last.role || null;
  app.innerHTML = '<div class="bar"><button class="back" data-act="nav" data-to="home">חזרה</button><div class="ttl"><b>כניסת בוחן</b></div></div>' +
    '<div class="wrap"><label class="f">קוד תחרות</label><input class="in" id="f-code" autocomplete="off" autocapitalize="off" value="' + esc(last.code || '') + '">' +
    '<label class="f">שם הבוחן</label><input class="in" id="f-name" autocomplete="name" value="' + esc(last.name || '') + '">' +
    '<label class="f">תפקיד</label><div class="roles">' +
    ROLES.map(function (r) { return '<button data-act="role" data-k="' + r.key + '" class="' + (S.role === r.key ? 'on' : '') + '">' + esc(r.label) + '</button>'; }).join('') +
    '</div><div class="err">' + esc(S.err) + '</div><button class="big primary" data-act="jlogin">כניסה</button></div>';
}
function renderALogin() {
  var last = LS.get('last', {});
  app.innerHTML = '<div class="bar"><button class="back" data-act="nav" data-to="home">חזרה</button><div class="ttl"><b>מנהל תחרות</b></div></div>' +
    '<div class="wrap"><label class="f">קוד תחרות</label><input class="in" id="f-code" autocomplete="off" autocapitalize="off" value="' + esc(last.code || '') + '">' +
    '<label class="f">קוד מנהל</label><input class="in" id="f-pin" type="password" autocomplete="off">' +
    '<div class="err">' + esc(S.err) + '</div>' +
    '<button class="big primary" data-act="alogin">כניסה</button>' +
    '<button class="big" data-act="acreate">הקמת תחרות חדשה עם הקודים האלה</button>' +
    '<p class="hint">בהקמה: קוד התחרות נמסר לבוחנים, קוד המנהל נשאר אצלך. לפחות 4 תווים בכל אחד.</p></div>';
}
function readVal(id) { var el = document.getElementById(id); return el ? el.value.trim() : ''; }
function fail(msg) { S.err = msg; var e = app.querySelector('.err'); if (e) e.textContent = msg; }

function judgeLogin() {
  var code = codeKey(readVal('f-code')), name = readVal('f-name');
  if (code.length < 4) return fail('יש להזין קוד תחרות');
  if (!name) return fail('יש להזין שם בוחן');
  if (!S.role) return fail('יש לבחור תפקיד');
  fail('מתחבר…');
  Store.connect(code).then(function () {
    if (!(Store.data.meta || {}).created) { Store.disconnect(); return fail('קוד תחרות לא מוכר'); }
    S.sess = { kind: 'judge', code: code, name: name, role: S.role, team: null };
    LS.set('sess', S.sess); LS.set('last', { code: code, name: name, role: S.role });
    go('teams');
  });
}
function adminLogin(create) {
  var code = codeKey(readVal('f-code')), pin = readVal('f-pin');
  if (code.length < 4 || pin.length < 4) return fail('קוד תחרות וקוד מנהל – לפחות 4 תווים');
  fail('מתחבר…');
  Store.connect(code).then(function () {
    var meta = Store.data.meta || {};
    if (create) {
      if (meta.created) { Store.disconnect(); return fail('כבר קיימת תחרות בקוד הזה'); }
      if (!Store.demo && !Store.online) { Store.disconnect(); return fail('אין חיבור – לא ניתן להקים תחרות כרגע'); }
      Store.write('meta', { created: Date.now(), pin: pin });
    } else {
      if (!meta.created) { Store.disconnect(); return fail('קוד תחרות לא מוכר'); }
      if (meta.pin !== pin) { Store.disconnect(); return fail('קוד מנהל שגוי'); }
    }
    S.sess = { kind: 'admin', code: code, pin: pin };
    LS.set('sess', S.sess);
    var last = LS.get('last', {}); last.code = code; LS.set('last', last);
    go('dash');
  });
}
function logout() { LS.del('sess'); S.sess = null; S.role = null; cur = null; Store.disconnect(); go('home'); }

/* ───────── בוחן: בחירת תאג"ד ───────── */
function renderTeams() {
  var role = roleOf(S.sess.role);
  app.innerHTML = '<div class="bar"><div class="ttl"><b>' + esc(role.label) + '</b><span>' + esc(S.sess.name) + '</span></div>' + syncHtml() +
    '<button class="back" data-act="logout">יציאה</button></div>' +
    '<div class="wrap"><p class="hint">בחר את התאג"ד הנבחן כעת</p><div class="teams">' +
    teamIds().map(function (tid) {
      var s = getSheet(tid, role.key);
      var cls = s ? (s.sub ? 'done' : 'draft') : '';
      var st = s ? (s.sub ? '✓ נשלח' : 'בתהליך') : 'טרם מולא';
      return '<button class="team ' + cls + '" data-act="open" data-t="' + tid + '"><b>' + esc(teamName(tid)) + '</b><span>' + st + '</span></button>';
    }).join('') + '</div></div>';
}

/* ───────── בוחן: דף הניקוד ───────── */
function openSheet(tid) {
  var ex = getSheet(tid, S.sess.role);
  cur = {
    team: tid, role: S.sess.role, rk: roleOf(S.sess.role).rubric,
    sheet: ex ? { a: clean(ex.a || {}), sub: !!ex.sub, by: ex.by, at: ex.at || 0, dev: ex.dev }
              : { a: {}, sub: false, by: S.sess.name, at: 0, dev: DEV },
    seen: !!ex,
    other: ex && ex.dev !== DEV ? ex.by : null,
    miss: false
  };
  S.sess.team = tid; LS.set('sess', S.sess);
  go('sheet');
}
function closeSheet() { cur = null; S.sess.team = null; LS.set('sess', S.sess); go('teams'); }
function breathMissed() { var b = getBreath(cur.team); return !!(b && b.v === 'n'); }

function notesHtml(it) {
  return (it.notes || []).map(function (n) { return '<div class="nt">' + esc(n) + '</div>'; }).join('');
}
function segBtn(id, v, cls, label, on, dis) {
  return '<button data-act="seg" data-id="' + id + '" data-v="' + v + '" class="' + (on ? 'on ' : '') + cls + '"' + dis + '>' + label + '</button>';
}
function itemHtml(it, a, locked, cross) {
  var v = a[it.id], dis = locked ? ' disabled' : '';
  if (it.t === 'note') {
    return '<div class="item note"><div class="tx">' + esc(it.text) + '<span class="tag">דגש · ללא ניקוד</span></div>' + notesHtml(it) + '</div>';
  }
  if (cross) {
    var miss = cur.miss && !v ? ' miss' : '';
    return '<div class="item' + miss + '"><div class="tx">' + esc(it.text) + '</div>' + notesHtml(it) + '<div class="seg">' +
      segBtn(it.id, 'y', 'g', 'בוצע', v === 'y', dis) + segBtn(it.id, 'n', 'r', 'לא בוצע', v === 'n', dis) +
      segBtn(it.id, 'x', 'x', 'לא רלוונטי', v === 'x', dis) + '</div></div>';
  }
  if (it.t === 'check' || it.t === 'penalty') {
    var forced = it.id === BREATH_ITEM && breathMissed();
    var on = !!v && !forced;
    return '<button class="chk' + (it.t === 'penalty' ? ' pen' : '') + (on ? ' on' : '') + (forced ? ' forced' : '') + '" data-act="tog" data-id="' + it.id + '"' +
      (locked || forced ? ' disabled' : '') + '><span class="box">' + (it.t === 'penalty' ? '−' : '✓') + '</span><span class="body"><span class="tx">' + esc(it.text) + '</span>' +
      (forced ? '<div class="nt">אופס אוטומטית: הפצוע הרביעי (ספירת נשימות) סומן "לא בוצע"</div>' : '') + notesHtml(it) +
      '</span><span class="p">' + (it.t === 'penalty' ? '−' : '') + fmt(it.pts) + '</span></button>';
  }
  if (it.t === 'tri') {
    return '<div class="item"><div class="tx">' + esc(it.text) + '</div>' + notesHtml(it) + '<div class="seg">' +
      segBtn(it.id, 'full', 'g', 'מלא · ' + fmt(it.pts), v === 'full', dis) +
      segBtn(it.id, 'part', 'a', 'חלקי · ' + fmt(it.partial), v === 'part', dis) +
      segBtn(it.id, 'none', 'r', 'לא · 0', v === 'none', dis) + '</div></div>';
  }
  if (it.t === 'count') {
    var h = '<div class="item"><div class="tx">' + esc(it.text) + '</div>' + notesHtml(it) + '<div class="seg">';
    for (var i = 0; i <= it.max; i++) h += segBtn(it.id, i, i ? 'g' : 'r', i + ' נק\'', Number(v) === i && v != null, dis);
    return h + '</div></div>';
  }
  if (it.t === 'time') {
    var miss2 = cur.miss && v == null ? ' miss' : '';
    return '<div class="item' + miss2 + '"><div class="tx">' + esc(it.text) + '</div><div class="topts">' +
      it.opts.map(function (o, i) {
        return '<button data-act="time" data-i="' + i + '" class="' + (v === i ? 'on' : '') + '"' + dis + '>' + esc(o.label) + '</button>';
      }).join('') + '</div></div>';
  }
  return '';
}
function catScoreText(c) {
  var rub = R[cur.rk];
  if (rub.cross) {
    var done = c.items.filter(function (it) { return cur.sheet.a[it.id]; }).length;
    return done + '/' + c.items.length;
  }
  var zero = null; if (breathMissed()) { zero = {}; zero[BREATH_ITEM] = true; }
  var s = 0; c.items.forEach(function (it) { s += itemScore(it, cur.sheet.a, zero); });
  return fmt(Math.max(0, s)) + ' / ' + c.max + (c.bonus ? ' (+' + c.bonus + ')' : '');
}
function catHtml(c) {
  var rub = R[cur.rk];
  return '<section class="cat" id="cat-' + c.id + '"><h3><span>' + esc(c.name) + '</span><em>' + catScoreText(c) + '</em></h3>' +
    c.items.map(function (it) { return itemHtml(it, cur.sheet.a, cur.sheet.sub, !!rub.cross); }).join('') + '</section>';
}
function headScore() {
  var rub = R[cur.rk];
  if (rub.cross) {
    var n = 0, all = 0;
    rub.cats.forEach(function (c) { c.items.forEach(function (it) { all++; if (cur.sheet.a[it.id]) n++; }); });
    return n + '<small> / ' + all + '</small>';
  }
  var zero = null; if (breathMissed()) { zero = {}; zero[BREATH_ITEM] = true; }
  return fmt(scoreSheet(cur.rk, cur.sheet.a, zero).total) + '<small> / ' + rub.max + '</small>';
}
function breathHtml(tid, locked) {
  var b = getBreath(tid), v = b ? b.v : null, dis = locked ? ' disabled' : '';
  return '<section class="cat" id="breath"><h3><span>פצוע רביעי · ספירת נשימות</span></h3><div class="item">' +
    '<div class="tx">האם הצוות הגיע לפצוע הרביעי וספר נשימות?</div>' +
    '<div class="nt">כל בוחן שראה מסמן. "לא בוצע" מאפס אצל מפקד הסטריפ את הסעיף "לא נעשה ויתור על פעולה מצילת חיים או על בטיחות לטובת הזמן".</div>' +
    '<div class="seg"><button data-act="breath" data-v="y" class="g' + (v === 'y' ? ' on' : '') + '"' + dis + '>בוצע</button>' +
    '<button data-act="breath" data-v="n" class="r' + (v === 'n' ? ' on' : '') + '"' + dis + '>לא בוצע</button></div>' +
    (b ? '<div class="nt">סומן על ידי ' + esc(b.by) + '</div>' : '') + '</div></section>';
}
function renderSheet() {
  var rub = R[cur.rk], role = roleOf(cur.role), locked = cur.sheet.sub;
  var h = '<div class="bar"><button class="back" data-act="close">חזרה</button><div class="ttl"><b>' + esc(teamName(cur.team)) + '</b><span>' + esc(role.label) + '</span></div>' +
    syncHtml() + '<div class="score" id="hscore">' + headScore() + '</div></div><div class="wrap">';
  if (locked) h += '<div class="banner lock">הדף נשלח וננעל. לפתיחה מחדש יש לפנות למנהל התחרות.</div>';
  else if (cur.other) h += '<div class="banner warn">שים לב: הדף הזה כבר התחיל להתמלא על ידי ' + esc(cur.other) + '. שינויים שלך יחליפו את שלו.</div>';
  if (rub.cross) h += '<p class="sub">סמן לכל סעיף: בוצע / לא בוצע / לא רלוונטי לפצוע שלך. הניקוד מחושב רוחבית מול שני בוחני הפצוע האחרים.</p>';
  if (rub.subtitle) h += '<p class="sub">' + esc(rub.title) + '<br>' + esc(rub.subtitle) + '</p>';
  if (rub.reference) h += '<details class="ref"><summary>' + esc(rub.reference.title) + '</summary>' +
    rub.reference.lines.map(function (l) { return '<div>' + esc(l) + '</div>'; }).join('') + '</details>';
  h += rub.cats.map(catHtml).join('');
  h += breathHtml(cur.team, false);
  h += '</div>';
  if (!locked) h += '<div class="foot"><div class="in"><div class="msg" id="fmsg"></div><button class="big primary" data-act="submit">שליחה ונעילת הדף</button></div></div>';
  app.innerHTML = h;
}
function refreshCat(catId) {
  var c = null; R[cur.rk].cats.forEach(function (x) { if (x.id === catId) c = x; });
  var el = document.getElementById('cat-' + catId);
  if (c && el) el.outerHTML = catHtml(c);
  var hs = document.getElementById('hscore'); if (hs) hs.innerHTML = headScore();
}
function saveSheet() {
  cur.sheet.at = Math.max(Date.now(), (cur.sheet.at || 0) + 1);
  cur.sheet.by = S.sess.name; cur.sheet.dev = DEV; cur.seen = true;
  Store.write('sheets/' + cur.team + '/' + cur.role, cur.sheet);
}
function setAnswer(id, v) {
  if (!cur || cur.sheet.sub) return;
  if (v === null) delete cur.sheet.a[id]; else cur.sheet.a[id] = v;
  saveSheet();
  refreshCat(ITEMS[cur.rk][id].cat.id);
  var fm = document.getElementById('fmsg'); if (fm) fm.textContent = '';
}
function missing() {
  var rub = R[cur.rk], n = 0;
  rub.cats.forEach(function (c) {
    c.items.forEach(function (it) {
      if (rub.cross && it.t !== 'note' && !cur.sheet.a[it.id]) n++;
      if (it.t === 'time' && cur.sheet.a[it.id] == null) n++;
    });
  });
  return n;
}
function submitSheet(b) {
  var m = missing();
  if (m) {
    cur.miss = true;
    R[cur.rk].cats.forEach(function (c) { refreshCat(c.id); });
    document.getElementById('fmsg').textContent = R[cur.rk].cross ? 'נותרו ' + m + ' סעיפים בלי סימון' : 'יש לבחור טווח זמן פינוי';
    var first = app.querySelector('.item.miss'); if (first) first.scrollIntoView({ block: 'center' });
    return;
  }
  if (!arm(b, 'לחץ שוב לאישור – אחרי השליחה הדף ננעל')) return;
  cur.sheet.sub = true; saveSheet();
  toast('הדף נשלח: ' + teamName(cur.team));
  closeSheet();
}
/* עדכון שהגיע ממכשיר אחר בזמן שהדף פתוח */
function sheetRemote() {
  var remote = getSheet(cur.team, cur.role);
  if (remote && remote.dev !== DEV && (remote.at || 0) > (cur.sheet.at || 0)) {
    cur.sheet = { a: clean(remote.a || {}), sub: !!remote.sub, by: remote.by, at: remote.at, dev: remote.dev };
    cur.seen = true; renderSheet(); toast('הדף עודכן ממכשיר אחר'); return;
  }
  if (!remote && cur.seen) { toast('הדף נמחק על ידי מנהל התחרות'); closeSheet(); return; }
  var el = document.getElementById('breath'); if (el) el.outerHTML = breathHtml(cur.team, false);
  if (cur.rk === 'strip') refreshCat(ITEMS.strip[BREATH_ITEM].cat.id);
}
function setBreath(tid, v, by) { Store.write('extra/' + tid + '/breath', { v: v, by: by, at: Date.now() }); }

/* ───────── מנהל: טבלת דירוג ───────── */
function cell(v) { return v == null ? '–' : fmt(v); }
function renderDash() {
  var rows = ranking(), rank = 0;
  var h = '<div class="bar"><div class="ttl"><b>ריכוז ציונים</b><span>קוד תחרות: ' + esc(S.sess.code) + '</span></div>' + syncHtml() +
    '<button class="back" data-act="logout">יציאה</button></div><div class="wrap wide">' +
    '<div class="tools"><button class="btn" data-act="csv">ייצוא לאקסל (CSV)</button><button class="btn" data-act="nav" data-to="names">שמות התאג"דים</button></div>' +
    '<div class="tblw"><table><thead><tr><th>#</th><th class="nm">תאג"ד</th><th>מט"ב<br>20</th><th>פצועים<br>24</th><th>קשר<br>17</th><th>סטריפ<br>42+3</th><th>סה"כ<br>103+3</th><th>דפים</th><th>פצוע 4</th></tr></thead><tbody>';
  rows.forEach(function (r) {
    var none = r.started === 0; if (!none) rank++;
    h += '<tr class="row' + (r.final ? ' final' : '') + (none ? ' none' : '') + '" data-act="detail" data-t="' + r.tid + '"><td>' + (none ? '' : rank) + '</td><td class="nm">' + esc(teamName(r.tid)) +
      '</td><td>' + cell(r.mtb) + '</td><td>' + cell(r.cas) + '</td><td>' + cell(r.comms) + '</td><td>' + cell(r.strip) + '</td><td class="tot">' + (none ? '–' : fmt(r.total)) +
      '</td><td class="st">' + (none ? '–' : (r.final ? '✓ סופי' : r.subs + '/6')) + '</td><td>' + (r.breath ? (r.breath.v === 'y' ? '✓' : '✗') : '–') + '</td></tr>';
  });
  h += '</tbody></table></div><p class="hint">הציון מתעדכן בזמן אמת גם מדפים שעוד לא נשלחו. "סופי" = כל 6 הדפים נשלחו והפצוע הרביעי סומן. שוויון מוכרע לפי ניקוד זמן הפינוי. לחיצה על שורה פותחת פירוט.</p></div>';
  app.innerHTML = h;
}
function markOf(it, a) {
  var v = a[it.id];
  if (it.t === 'check') return v ? ['✓', 'y'] : ['✗', 'n'];
  if (it.t === 'penalty') return v ? ['−' + fmt(it.pts), 'n'] : ['', ''];
  if (it.t === 'tri') return v === 'full' ? ['מלא', 'y'] : v === 'part' ? ['חלקי', 'h'] : ['לא', 'n'];
  if (it.t === 'count') return [(Number(v) || 0) + ' נק\'', Number(v) ? 'y' : 'n'];
  if (it.t === 'time') return v == null ? ['–', ''] : [fmt(it.opts[v].pts) + ' נק\'', 'y'];
  return ['', ''];
}
function roleHead(tid, r) {
  var s = getSheet(tid, r.key);
  if (!s) return '<div class="rolehd"><span>' + esc(r.label) + ': טרם מולא</span></div>';
  return '<div class="rolehd"><span>' + esc(r.label) + ': ' + esc(s.by || '') + ' · ' + (s.sub ? 'נשלח' : 'בתהליך') + '</span><span class="acts">' +
    (s.sub ? '<button class="btn" data-act="unlock" data-r="' + r.key + '">פתיחה לעריכה</button>' : '') +
    '<button class="btn danger" data-act="delsheet" data-r="' + r.key + '">מחיקה</button></span></div>';
}
function plainSheetHtml(tid, r, zero) {
  var s = getSheet(tid, r.key), rub = R[r.rubric];
  var h = '<section class="cat"><h3><span>' + esc(rub.title) + '</span><em>' + (s ? fmt(scoreSheet(r.rubric, s.a || {}, zero).total) : '–') + ' / ' + rub.max + '</em></h3>' + roleHead(tid, r);
  if (s) {
    var a = s.a || {}, sc = scoreSheet(r.rubric, a, zero);
    h += '<div class="dl">';
    rub.cats.forEach(function (c) {
      h += '<div class="ch"><span>' + esc(c.name) + '</span><span dir="ltr">' + fmt(sc.cats[c.id]) + ' / ' + c.max + '</span></div>';
      c.items.forEach(function (it) {
        if (it.t === 'note') return;
        var m = markOf(it, a);
        if (zero && zero[it.id]) m = ['0 · פצוע 4', 'n'];
        if (it.t === 'penalty' && !a[it.id]) return;
        var tx = it.t === 'time' && a[it.id] != null ? it.opts[a[it.id]].label : it.text;
        h += '<div class="r"><span class="m ' + m[1] + '">' + m[0] + '</span><span>' + esc(tx) + '</span></div>';
      });
    });
    h += '</div>';
  }
  return h + '</section>';
}
function casMatrixHtml(tid, calc) {
  var cd = calc.casDetail, sym = { y: ['✓', 'y'], n: ['✗', 'n'], x: ['ל"ר', 'x'] };
  var h = '<section class="cat"><h3><span>בוחני פצוע · חישוב רוחבי</span><em>' + cell(calc.cas) + ' / 24</em></h3>';
  CAS_KEYS.forEach(function (k) { h += roleHead(tid, roleOf(k)); });
  h += '<div class="tblw"><table class="mx"><thead><tr><th class="nm">סעיף</th><th>1</th><th>2</th><th>3</th><th>ניקוד</th></tr></thead><tbody>';
  R.cas.cats.forEach(function (c) {
    c.items.forEach(function (it) {
      var d = cd.items[it.id];
      h += '<tr class="' + (d.fail ? 'fail' : (d.pts ? 'pass' : '')) + '"><td class="tx">' + esc(it.text) + '</td>' +
        d.vals.map(function (v) { var s = v ? sym[v] : ['–', 'x']; return '<td class="' + s[1] + '">' + s[0] + '</td>'; }).join('') +
        '<td class="res">' + fmt(d.pts) + ' / ' + fmt(it.pts) + (d.pending && cd.n ? '<br><small>חלקי</small>' : '') + '</td></tr>';
    });
  });
  return h + '</tbody></table></div></section>';
}
function renderDetail() {
  var tid = S.detail, c = teamCalc(tid);
  var h = '<div class="bar"><button class="back" data-act="nav" data-to="dash">חזרה</button><div class="ttl"><b>' + esc(teamName(tid)) + '</b><span>' +
    (c.final ? 'ציון סופי' : c.subs + '/6 דפים נשלחו') + '</span></div>' + syncHtml() + '<div class="score">' + fmt(c.total) + '</div></div><div class="wrap wide">' +
    '<div class="kpis"><div class="kpi"><b>' + cell(c.mtb) + '</b><span>מט"ב / 20</span></div><div class="kpi"><b>' + cell(c.cas) + '</b><span>פצועים / 24</span></div>' +
    '<div class="kpi"><b>' + cell(c.comms) + '</b><span>קשר / 17</span></div><div class="kpi"><b>' + cell(c.strip) + '</b><span>סטריפ / 42+3</span></div>' +
    '<div class="kpi t"><b>' + fmt(c.total) + '</b><span>סה"כ / 103+3</span></div></div>';
  h += breathHtml(tid, false);
  h += casMatrixHtml(tid, c);
  h += plainSheetHtml(tid, roleOf('mtb'), null) + plainSheetHtml(tid, roleOf('comms'), null) + plainSheetHtml(tid, roleOf('strip'), c.zero);
  app.innerHTML = h + '</div>';
}
function renderNames() {
  var m = (Store.data.meta || {}).teams || {};
  app.innerHTML = '<div class="bar"><button class="back" data-act="nav" data-to="dash">חזרה</button><div class="ttl"><b>שמות התאג"דים</b></div></div>' +
    '<div class="wrap wide"><p class="hint">שדה ריק = שם ברירת המחדל.</p><div class="names">' +
    teamIds().map(function (tid) {
      return '<div><label>תאג"ד ' + tid.slice(1) + '</label><input class="in" data-t="' + tid + '" value="' + esc(m[tid] || '') + '"></div>';
    }).join('') + '</div><button class="big primary" data-act="savenames">שמירה</button></div>';
}
function exportCsv() {
  var q = function (s) { return '"' + String(s).replace(/"/g, '""') + '"'; };
  var lines = [['דירוג', 'תאג"ד', 'מט"ב', 'פצועים', 'קשר', 'מפקד הסטריפ', 'סה"כ', 'דפים שנשלחו', 'פצוע רביעי'].map(q).join(',')];
  var rank = 0;
  ranking().forEach(function (r) {
    if (!r.started) return; rank++;
    lines.push([rank, teamName(r.tid), cell(r.mtb), cell(r.cas), cell(r.comms), cell(r.strip), fmt(r.total), r.subs + '/6',
      r.breath ? (r.breath.v === 'y' ? 'בוצע' : 'לא בוצע') : 'לא סומן'].map(q).join(','));
  });
  var blob = new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
  var a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'tagad-scores.csv';
  document.body.appendChild(a); a.click(); a.remove();
}

/* ───────── אירועים ───────── */
var ACT = {
  nav: function (b) { go(b.dataset.to); },
  role: function (b) { S.role = b.dataset.k; app.querySelectorAll('.roles button').forEach(function (x) { x.classList.toggle('on', x === b); }); },
  jlogin: judgeLogin,
  alogin: function () { adminLogin(false); },
  acreate: function () { adminLogin(true); },
  logout: function (b) { if (arm(b, 'לאשר יציאה?')) logout(); },
  open: function (b) { openSheet(b.dataset.t); },
  close: closeSheet,
  tog: function (b) { var id = b.dataset.id; setAnswer(id, cur.sheet.a[id] ? null : true); },
  seg: function (b) {
    var id = b.dataset.id, it = ITEMS[cur.rk][id].it;
    setAnswer(id, it.t === 'count' ? Number(b.dataset.v) : b.dataset.v);
  },
  time: function (b) { setAnswer('time', Number(b.dataset.i)); },
  breath: function (b) {
    var tid = S.screen === 'detail' ? S.detail : cur.team;
    setBreath(tid, b.dataset.v, S.sess.kind === 'admin' ? 'מנהל התחרות' : S.sess.name);
  },
  submit: submitSheet,
  detail: function (b) { S.detail = b.dataset.t; go('detail'); },
  unlock: function (b) {
    var s = getSheet(S.detail, b.dataset.r); if (!s) return;
    s = clean(s); s.sub = false; s.at = Math.max(Date.now(), (s.at || 0) + 1); s.dev = 'admin';
    Store.write('sheets/' + S.detail + '/' + b.dataset.r, s); toast('הדף נפתח לעריכה');
  },
  delsheet: function (b) {
    if (!arm(b, 'לחץ שוב למחיקה')) return;
    Store.write('sheets/' + S.detail + '/' + b.dataset.r, null); toast('הדף נמחק');
  },
  csv: exportCsv,
  savenames: function () {
    var o = {};
    app.querySelectorAll('.names input').forEach(function (i) { if (i.value.trim()) o[i.dataset.t] = i.value.trim(); });
    Store.write('meta/teams', Object.keys(o).length ? o : null); toast('נשמר'); go('dash');
  }
};
app.addEventListener('click', function (e) {
  var b = e.target.closest('[data-act]');
  if (!b || b.disabled) return;
  var f = ACT[b.dataset.act]; if (f) f(b);
});
app.addEventListener('keydown', function (e) {
  if (e.key !== 'Enter' || e.target.tagName !== 'INPUT') return;
  if (S.screen === 'jlogin') judgeLogin(); else if (S.screen === 'alogin') adminLogin(false);
});

/* ───────── התחלה: חזרה לסשן שמור ───────── */
(function boot() {
  var sess = LS.get('sess', null);
  if (!sess) return render();
  app.innerHTML = '<div class="wrap home"><p>טוען…</p></div>';
  Store.connect(sess.code).then(function () {
    var meta = Store.data.meta || {};
    if (!meta.created || (sess.kind === 'admin' && meta.pin !== sess.pin)) { LS.del('sess'); Store.disconnect(); return render(); }
    S.sess = sess;
    if (sess.kind === 'admin') return go('dash');
    S.role = sess.role;
    if (sess.team) openSheet(sess.team); else go('teams');
  });
})();

})();
