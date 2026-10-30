import { describe, expect, it } from "vitest";
import { constellationAt } from "./constellation";

// [RA°, Dec°, IAU abbreviation], computed with astronomy-engine's Constellation().
const VECTORS: [number, number, string][] = [[335.7,-2.4,"Aqr"],[83.6,-5.4,"Ori"],[10.68,41.27,"And"],[279.23,38.78,"Lyr"],[201.3,-43,"Cen"],[0,89.9,"UMi"],[0,-89.9,"Oct"],[180,0,"Vir"],[266.4,-29,"Sgr"],[214.94,-23.67,"Hya"],[195.225,76.953,"Cam"],[241.987,3.348,"Ser"],[313.162,56.166,"Cep"],[26.841,84.124,"Cep"],[75.468,-37.828,"Cae"],[357.394,-61.876,"Tuc"],[138.263,-69.967,"Car"],[25.918,20.326,"Psc"],[332.645,38.255,"Lac"],[266.841,-60.759,"Pav"],[222.523,-0.463,"Vir"],[73.404,51.687,"Aur"],[24.809,37.262,"And"],[52.684,-71.012,"Hyi"],[257.936,28.527,"Her"],[310.757,39.438,"Cyg"],[300.907,29.013,"Vul"],[13.031,-18.783,"Cet"],[54.099,18.524,"Tau"],[137.908,-23.652,"Hya"],[284.467,-21.976,"Sgr"],[314.802,6.671,"Equ"],[72.203,-4.358,"Eri"],[206.662,-9.774,"Vir"],[107.401,42.885,"Aur"],[216.285,-17.066,"Lib"],[258.281,10.005,"Oph"],[143.807,8.48,"Leo"],[85.449,-55.843,"Pic"],[212.862,2.874,"Vir"],[163.694,-24.205,"Hya"],[162.686,-57.215,"Car"],[277.627,-36.533,"Sgr"],[43.435,44.455,"Per"],[217.393,13.6,"Boo"],[335.596,-30.173,"PsA"],[172.956,-12.296,"Crt"],[227.372,21.127,"Boo"],[83.387,-38.018,"Col"]];

describe("constellationAt", () => {
  it("matches astronomy-engine across the sky", () => {
    for (const [ra, dec, abbr] of VECTORS) {
      expect(constellationAt(ra, dec)?.abbr, `RA ${ra}, Dec ${dec}`).toBe(abbr);
    }
  });

  it("names the showcase fields' constellation", () => {
    expect(constellationAt(335.7, -2.4)?.name).toBe("Aquarius");
  });

  it("rejects bad input", () => {
    expect(constellationAt(Number.NaN, 0)).toBeNull();
    expect(constellationAt(0, 95)).toBeNull();
  });
});
