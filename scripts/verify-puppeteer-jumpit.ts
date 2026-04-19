import { PuppeteerFetcher } from "../packages/runner/dist/jobPosting/puppeteerFetcher.js";

const TEST_URL = process.env["JUMPIT_URL"] ?? "https://jumpit.saramin.co.kr/position/38834";

async function main(): Promise<void> {
  const fetcher = new PuppeteerFetcher();
  try {
    const startedAt = Date.now();
    const result = await fetcher.fetch(TEST_URL);
    const durationMs = Date.now() - startedAt;

    console.log(JSON.stringify({
      status: result.status,
      finalUrl: result.finalUrl,
      htmlLength: result.html.length,
      fetcherKind: result.fetcherKind,
      durationMs
    }, null, 2));

    if (result.status !== 200) {
      throw new Error(`unexpected status: ${result.status}`);
    }
    if (result.html.length < 10_000) {
      throw new Error(`html too short: ${result.html.length}`);
    }
    if (!result.finalUrl.includes("jumpit.saramin.co.kr")) {
      throw new Error(`unexpected finalUrl: ${result.finalUrl}`);
    }

    console.log("VERIFY OK");
  } finally {
    await fetcher.close();
  }
}

void main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
