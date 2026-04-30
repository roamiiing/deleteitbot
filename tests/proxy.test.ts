import { expect, test } from "bun:test";
import { getProxyUrl, proxyMode } from "../src/proxy";

test("proxy helper chooses Telegram proxy env and ignores global proxy env", () => {
  expect(getProxyUrl({ TG_HTTPS_PROXY: "http://secure:3128", TG_HTTP_PROXY: "http://plain:3128" })).toBe("http://secure:3128");
  expect(getProxyUrl({ TG_HTTP_PROXY: "http://plain:3128" })).toBe("http://plain:3128");
  expect(getProxyUrl({ tg_https_proxy: "http://lower:3128" })).toBe("http://lower:3128");
  expect(getProxyUrl({ TG_HTTPS_PROXY: "http://secure:3128", TG_NO_PROXY: "api.telegram.org" })).toBeUndefined();
  expect(getProxyUrl({ HTTPS_PROXY: "http://global:3128", HTTP_PROXY: "http://global:3128" })).toBeUndefined();
  expect(proxyMode({ TG_HTTPS_PROXY: "http://user:pass@secure:3128" })).toBe("http://secure:3128");
});
