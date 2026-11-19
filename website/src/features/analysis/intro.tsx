import { ArrowRight, Info } from "lucide-react";
import { Modal } from "./modal";

const introKey = "map-master-analysis-intro-v1";

/** Called only after the map has mounted in the browser. Storage is optional. */
export function needsIntroduction() {
  try { return localStorage.getItem(introKey) !== "seen"; } catch { return true; }
}
export function rememberIntroduction() {
  try { localStorage.setItem(introKey, "seen"); } catch { /* Help still works when browser storage is unavailable. */ }
}

export function AnalysisIntro({ close, trySample, canTrySample, isSample }: { close: () => void; trySample: () => void; canTrySample: boolean; isSample: boolean }) {
  return <Modal title="A quick guide to Analysis" close={close} className="an-intro-dialog" descriptionId="analysis-intro-description">
    <div className="an-intro-body">
      <span className="an-intro-label">FROM POINTS TO ANSWERS</span>
      <h3>What needs attention in this area?</h3>
      <p id="analysis-intro-description">Choose an area on the map to see which objects fall inside, how many there are and what their values add up to.</p>
      <div className="an-intro-example"><Info size={18} /><div><strong>{isSample ? "You’re exploring a fictitious city-services scenario" : "You’re exploring your own dataset"}</strong>{isSample ? <p>Each dot is an invented report about waste, street lighting, road surfaces or green spaces. Its colour shows the type. The <b>cost</b> field is an estimated repair cost in euros.</p> : <p>Choose a field under <b>Colour & group by</b> to give the map and category chart meaning. Select a <b>Numeric measure</b> to calculate totals and averages.</p>}</div></div>
      <ol className="an-intro-steps">
        <li><span>1</span><div><strong>Choose where to look</strong><p>{isSample ? <>Select <b>City centre</b> in Analysis area, or draw your own boundary.</> : <>Draw a boundary or import polygons using <b>Import areas</b>.</>} The matching count, table and charts update for that area when you finish.</p></div></li>
        <li><span>2</span><div><strong>Ask a more specific question</strong><p>{isSample ? <>Click <b>Waste</b> in the category chart to show waste reports only.</> : <>Click a category or a numeric range in the charts to narrow your selection.</>} Click again to clear it. Faded objects are outside your current filters.</p></div></li>
        <li><span>3</span><div><strong>Read the answer</strong><p><b>Matching features</b> counts {isSample ? "reports" : "objects"}. <b>Sum</b> adds their {isSample ? "known cost estimates" : "numeric values"}; <b>Average</b> averages them. Missing values are excluded. Export the matching {isSample ? "reports" : "objects"} when you’re ready.</p></div></li>
      </ol>
      <p className="an-intro-mobile-note">On a small screen, use <b>Configure</b> and <b>Insights</b> to open the side panels.</p>
      <p className="an-intro-disclosure">{isSample ? "The sample’s locations, concentrations and costs are simulated, not real Amsterdam records or street addresses. You can replace it with your own GeoJSON or CSV." : "Analysis uses the full attribute value of each matching feature, without area weighting. Files stay in your browser. Committed work is recovered in this browser; use Save analysis for a backup to share or archive your work."}</p>
    </div>
    <div className="an-intro-actions">{canTrySample ? <><button className="an-button" onClick={close}>Explore on my own</button><button className="an-button an-primary" onClick={trySample}>Try City centre <ArrowRight size={14} /></button></> : <button className="an-button an-primary" onClick={close}>Back to analysis <ArrowRight size={14} /></button>}</div>
  </Modal>;
}
