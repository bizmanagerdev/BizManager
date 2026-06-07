// TEMPORARY DIAGNOSTIC ROUTE — safe to delete.
// Reproduces the DateInput + portal Dialog + clickable-row setup in isolation,
// with full event/navigation logging, to pin down why picking a delivery date
// "jumps to the order page". Open http://localhost:3000/api/datetest and follow
// the on-screen steps. It needs no login (the /api path is public in middleware).

const HTML = String.raw`<!doctype html>
<html lang="he" dir="rtl">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Date picker diagnostic</title>
<style>
  body { font-family: system-ui, sans-serif; margin: 0; padding: 16px; background:#f5f5f5; }
  .row { border:2px solid #4477cc; border-radius:10px; padding:12px; background:#fff; cursor:pointer; }
  .row:hover { background:#eef3ff; }
  button { font-size:15px; padding:8px 12px; border-radius:8px; border:1px solid #999; background:#fff; cursor:pointer; }
  .field { position:relative; display:inline-flex; align-items:center; direction:ltr; }
  .field input[type=text]{ font-size:16px; padding:8px 34px 8px 8px; border:1px solid #999; border-radius:8px; }
  .iconbtn{ position:absolute; right:6px; top:50%; transform:translateY(-50%); border:none; background:transparent; font-size:18px; }
  .hidden-date{ position:absolute; right:6px; bottom:0; opacity:0; pointer-events:none; width:0; height:0; }
  #log { white-space:pre-wrap; font-family:ui-monospace,Menlo,monospace; font-size:12px; background:#111; color:#0f0; padding:12px; border-radius:8px; margin-top:16px; max-height:50vh; overflow:auto; }
  .dialog-overlay{ position:fixed; inset:0; background:rgba(0,0,0,.4); z-index:50; }
  .dialog-content{ position:fixed; left:50%; top:50%; transform:translate(-50%,-50%); background:#fff; padding:20px; border-radius:12px; z-index:51; width:min(420px,92vw); }
  h2{ margin:.2em 0; font-size:16px; }
</style>
</head>
<body>
<h2>אבחון בורר תאריך (Date picker diagnostic)</h2>
<ol style="font-size:14px">
  <li>לחצו על הכפתור "אישור אספקה" כדי לפתוח את הדיאלוג.</li>
  <li>לחצו על אייקון היומן 📅, ובחרו תאריך מהחלון שנפתח.</li>
  <li>צלמו מסך של הלוג השחור למטה ושלחו לי.</li>
</ol>

<div id="root"></div>
<div id="log"></div>

<script crossorigin src="https://unpkg.com/react@18/umd/react.production.min.js"></script>
<script crossorigin src="https://unpkg.com/react-dom@18/umd/react-dom.production.min.js"></script>
<script>
const logEl = document.getElementById('log');
function log(msg){
  const t = new Date().toISOString().slice(11,23);
  logEl.textContent += '['+t+'] '+msg+'\n';
  logEl.scrollTop = logEl.scrollHeight;
}
function desc(el){
  if(!(el instanceof Element)) return String(el);
  const inDialog = !!el.closest('[role="dialog"]');
  return '<'+el.tagName.toLowerCase()+(el.type?(' type='+el.type):'')+'>'+(inDialog?' [inside dialog]':' [OUTSIDE dialog]');
}

// --- navigation detectors ---
const _push = history.pushState.bind(history);
history.pushState = function(...a){ log('NAVIGATION! history.pushState -> '+a[2]); return _push(...a); };
const _replace = history.replaceState.bind(history);
history.replaceState = function(...a){ log('NAVIGATION! history.replaceState -> '+a[2]); return _replace(...a); };
window.addEventListener('popstate', ()=>log('NAVIGATION! popstate'));
window.addEventListener('hashchange', ()=>log('NAVIGATION! hashchange'));
window.addEventListener('beforeunload', ()=>log('NAVIGATION! beforeunload (full page nav)'));

// global capture click logger
window.addEventListener('click', (e)=>log('window CLICK (capture). target='+desc(e.target)), true);

const {useState, useRef, createElement: h} = React;
const {createPortal} = ReactDOM;

function DateField(){
  const [val,setVal] = useState('');
  const hidden = useRef(null);
  return h('div',{className:'field',
      onClick:()=>log('  field-div onClick (bubbled). '),
    },
    h('input',{type:'text', placeholder:'dd/mm/yy', value:val, onChange:e=>{log('  text input onChange='+e.target.value); setVal(e.target.value);} }),
    h('button',{className:'iconbtn', type:'button', onClick:()=>{
      log('  calendar icon onClick -> showPicker()');
      const el = hidden.current;
      try { el.showPicker ? el.showPicker() : el.click(); } catch(err){ log('  showPicker threw: '+err+' -> el.click()'); el.click(); }
    }}, '📅'),
    h('input',{ref:hidden, className:'hidden-date', type:'date', value:val,
      onChange:e=>{ log('  >>> hidden date input onChange = '+e.target.value+' (DATE PICKED)'); setVal(e.target.value); },
      onClick:e=>log('  hidden date input onClick (bubbled).'),
      tabIndex:-1, 'aria-hidden':'true'
    })
  );
}

function Dialog({onClose}){
  return createPortal(
    h('div',null,
      h('div',{className:'dialog-overlay', onClick:()=>{log('overlay onClick'); onClose();}}),
      h('div',{className:'dialog-content', role:'dialog',
        onClick:()=>log('  dialog-content onClick (bubbled).')},
        h('h2',null,'אישור אספקת הזמנה'),
        h('p',{style:{fontSize:'13px',color:'#666'}},'בחרו תאריך אספקה:'),
        h(DateField),
        h('div',{style:{marginTop:'16px'}},
          h('button',{type:'button', onClick:()=>{log('SAVE button clicked (dialog still open = good)'); }}, 'אישור אספקה (שמור)')
        )
      )
    ),
    document.body
  );
}

function Row(){
  const [open,setOpen] = useState(false);
  return h('div',{className:'row',
      onClick:(e)=>{
        const ignore = !!(e.target.closest && e.target.closest('a, button, input, textarea, select, label, [role="dialog"]'));
        log('ROW onClick. target='+desc(e.target)+' -> '+(ignore?'IGNORED (no nav)':'WOULD NAVIGATE to /sales/orders/123'));
      }
    },
    h('div',null,'שורת הזמנה (clickable row) #123'),
    h('button',{type:'button', style:{marginTop:'8px'}, onClick:()=>{log('open dialog'); setOpen(true);}}, 'אישור אספקה'),
    open ? h(Dialog,{onClose:()=>{log('dialog onClose (CLOSED)'); setOpen(false);}}) : null
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(h(Row));
log('ready. React '+React.version);
</script>
</body>
</html>`;

export function GET() {
  return new Response(HTML, {
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}
