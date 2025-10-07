const scanScreen = document.getElementById("scanScreen");
const mainScreen = document.getElementById("mainScreen");
const userDisplay = document.getElementById("userDisplay");
const catalog = document.getElementById("catalog");
const overlay = document.getElementById("overlay");
const overlayTitle = document.getElementById("overlayTitle");
const overlayText = document.getElementById("overlayText");
const btnOverlayClose = document.getElementById("btnOverlayClose");

let currentUser = null;
let selectedTool = null;
let requestId = null;
let pollTimer = null;

const tools = [
  {id:"drill", name:"Cordless Drill", desc:"18V Battery", icon:"🔩"},
  {id:"sdriver", name:"Screwdriver Set", desc:"12 pcs magnetic", icon:"🪛"},
  {id:"solder", name:"Soldering Iron", desc:"Temp Controlled", icon:"⚡"},
  {id:"multi", name:"Multimeter", desc:"DC/AC/Ohm", icon:"📟"},
  {id:"laser", name:"Laser Level", desc:"Auto leveling", icon:"📏"},
  {id:"tape", name:"Tape Measure", desc:"5m retractable", icon:"📐"},
  {id:"glue", name:"Glue Gun", desc:"Hot glue, 40W", icon:"🧴"},
  {id:"saw", name:"Mini Saw", desc:"Battery powered", icon:"🪚"}
];

function buildCatalog() {
  catalog.innerHTML = "";
  tools.forEach(t => {
    const div = document.createElement("div");
    div.className = "tool-card";
    div.innerHTML = `
      <div class="tool-icon">${t.icon}</div>
      <div class="tool-name">${t.name}</div>
      <div class="tool-desc">${t.desc}</div>
    `;
    div.addEventListener("click", () => selectTool(t, div));
    catalog.appendChild(div);
  });
}
function selectTool(tool, el) {
  document.querySelectorAll(".tool-card").forEach(c => c.classList.remove("selected"));
  el.classList.add("selected");
  selectedTool = tool;
}

/* simulate scan with Enter */
window.addEventListener("keydown", (e)=>{
  if(scanScreen.classList.contains("active") && e.key==="Enter"){
    const uid = "u" + Math.floor(Math.random()*900000+100000);
    login(uid);
  }
});

function login(uid){
  currentUser = uid;
  userDisplay.textContent = "User: " + uid;
  scanScreen.classList.remove("active");
  mainScreen.classList.add("active");
  buildCatalog();
}

document.getElementById("btnHome").addEventListener("click",()=>{
  mainScreen.classList.remove("active");
  scanScreen.classList.add("active");
  selectedTool = null;
});

document.getElementById("btnDispense").addEventListener("click", async ()=>{
  if(!selectedTool){alert("Select a tool first");return;}
  showOverlay("Processing request…","Contacting backend to dispense tool");
  try{
    const res = await fetch("/api/dispense",{
      method:"POST",
      headers:{"Content-Type":"application/json"},
      body:JSON.stringify({
        user_id: currentUser,
        action:"dispense",
        tool_id: selectedTool.id,
        period:"2h"
      })
    });
    const j = await res.json();
    requestId = j.request_id;
    pollStatus();
  }catch(e){
    showOverlay("Error", e.message, true);
  }
});

function showOverlay(title,text,done=false){
  overlayTitle.textContent=title;
  overlayText.textContent=text;
  overlay.classList.remove("hidden");
  btnOverlayClose.classList.toggle("hidden",!done);
}
btnOverlayClose.addEventListener("click",()=>{
  overlay.classList.add("hidden");
  selectedTool=null;
  document.querySelectorAll(".tool-card").forEach(c=>c.classList.remove("selected"));
});

async function pollStatus(){
  clearInterval(pollTimer);
  pollTimer=setInterval(async ()=>{
    try{
      const r=await fetch(`/api/requests/${requestId}/status`);
      const j=await r.json();
      if(j.status==="done"){
        clearInterval(pollTimer);
        showOverlay("Dispense Complete!","Please collect your tool.",true);
      } else {
        overlayText.textContent="Status: "+j.status;
      }
    }catch{}
  },1000);
}
