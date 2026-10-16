export function analyzeEnergy(input) {
  const rows = Array.isArray(input) ? input : input?.readings;
  if (!Array.isArray(rows) || rows.length === 0) throw new Error('Provide readings as an array of {period,kwh,costPerKwh}.');
  const clean = rows.map((r,i)=>({period:String(r.period ?? `row-${i+1}`),kwh:Number(r.kwh),costPerKwh:Number(r.costPerKwh)}));
  if (clean.some(r=>!Number.isFinite(r.kwh)||r.kwh<0||!Number.isFinite(r.costPerKwh)||r.costPerKwh<0)) throw new Error('Each reading must have non-negative numeric kwh and costPerKwh values.');
  const totalKwh=clean.reduce((s,r)=>s+r.kwh,0); const totalCost=clean.reduce((s,r)=>s+r.kwh*r.costPerKwh,0);
  const avgRate=totalKwh ? totalCost/totalKwh : 0;
  const peak=[...clean].sort((a,b)=>b.kwh-a.kwh)[0];
  return {kind:'industrial-energy-analysis',readings:clean.length,totalKwh:Number(totalKwh.toFixed(2)),estimatedTotalCost:Number(totalCost.toFixed(2)),weightedAverageCostPerKwh:Number(avgRate.toFixed(4)),highestConsumptionPeriod:peak.period,highestPeriodKwh:peak.kwh,recommendations:['Compare peak-consumption periods with production volume and shift schedules.','Check compressed-air leaks, idle equipment, power-factor penalties, and preventive-maintenance records.','Validate tariff, demand charges, and meter coverage before estimating savings.'],safety:'Analysis only. No machinery, PLC, or production-control actions are available.',assumptions:['Cost is estimated as kWh × supplied costPerKwh.','No savings are claimed without baseline and production-normalized comparison.']};
}
