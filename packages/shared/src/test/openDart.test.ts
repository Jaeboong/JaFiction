import * as assert from "node:assert/strict";
import test from "node:test";
import JSZip from "jszip";
import { OpenDartClient } from "../core/openDart";
import { cleanupTempWorkspace, createTempWorkspace } from "./helpers";

test("openDart client resolves corp code, overview, and financials with cached corp codes", async (t) => {
  const workspaceRoot = await createTempWorkspace();
  t.after(async () => cleanupTempWorkspace(workspaceRoot));

  const zip = new JSZip();
  zip.file(
    "CORPCODE.xml",
    `<?xml version="1.0" encoding="UTF-8"?>
    <result>
      <list>
        <corp_code>00126380</corp_code>
        <corp_name>에코마케팅</corp_name>
        <stock_code>230360</stock_code>
        <modify_date>20260407</modify_date>
      </list>
    </result>`
  );
  const corpCodeBuffer = await zip.generateAsync({ type: "nodebuffer" });

  let corpCodeFetches = 0;
  const fetchImpl: typeof fetch = async (input) => {
    const url = new URL(String(input));
    if (url.pathname.endsWith("/corpCode.xml")) {
      corpCodeFetches += 1;
      return new Response(new Uint8Array(corpCodeBuffer), { status: 200 });
    }

    if (url.pathname.endsWith("/company.json")) {
      return Response.json({
        status: "000",
        corp_name: "에코마케팅",
        stock_code: "230360",
        ceo_nm: "김철수",
        corp_cls: "K",
        adres: "서울시",
        hm_url: "https://echomarketing.co.kr",
        est_dt: "20030301",
        acc_mt: "12"
      });
    }

    if (url.pathname.endsWith("/fnlttSinglAcntAll.json")) {
      return Response.json({
        status: "000",
        list: [
          { account_nm: "매출액", thstrm_amount: "448,812,712,000" },
          { account_nm: "영업이익", thstrm_amount: "45,446,620,000" },
          { account_nm: "당기순이익", thstrm_amount: "17,687,230,000" },
          { account_nm: "자산총계", thstrm_amount: "420,900,000,000" },
          { account_nm: "부채총계", thstrm_amount: "155,000,000,000" },
          { account_nm: "자본총계", thstrm_amount: "266,000,000,000" }
        ]
      });
    }

    throw new Error(`Unexpected OpenDART URL: ${url.toString()}`);
  };

  const client = new OpenDartClient(workspaceRoot, "test-key", fetchImpl);
  const first = await client.resolveAndFetchCompany("에코마케팅");
  const secondCorpCodes = await client.loadCorpCodes();

  assert.equal(first.status, "resolved");
  if (first.status !== "resolved") {
    return;
  }

  assert.equal(first.match.corpCode, "00126380");
  assert.equal(first.overview.ceoName, "김철수");
  assert.equal(first.financials.length, 3);
  assert.equal(first.financials[0]?.revenue, 448812712000);
  assert.equal(secondCorpCodes[0]?.corpName, "에코마케팅");
  assert.equal(corpCodeFetches, 1);
});

test("openDart client returns ambiguous matches when corp names collide", async (t) => {
  const workspaceRoot = await createTempWorkspace();
  t.after(async () => cleanupTempWorkspace(workspaceRoot));

  const zip = new JSZip();
  zip.file(
    "CORPCODE.xml",
    `<?xml version="1.0" encoding="UTF-8"?>
    <result>
      <list>
        <corp_code>001</corp_code>
        <corp_name>에코마케팅</corp_name>
        <stock_code>111111</stock_code>
      </list>
      <list>
        <corp_code>002</corp_code>
        <corp_name>에코마케팅</corp_name>
        <stock_code>222222</stock_code>
      </list>
    </result>`
  );
  const corpCodeBuffer = await zip.generateAsync({ type: "nodebuffer" });

  const client = new OpenDartClient(workspaceRoot, "test-key", async (input) => {
    const url = new URL(String(input));
    if (url.pathname.endsWith("/corpCode.xml")) {
      return new Response(new Uint8Array(corpCodeBuffer), { status: 200 });
    }
    throw new Error(`Unexpected URL: ${url.toString()}`);
  });

  const resolution = await client.resolveAndFetchCompany("에코마케팅");
  assert.equal(resolution.status, "ambiguous");
  if (resolution.status !== "ambiguous") {
    return;
  }
  assert.equal(resolution.candidates.length, 2);
});
