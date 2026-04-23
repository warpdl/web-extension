// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import { getPlayerResponse } from "../../../../../src/detect/detectors/youtube/player_data";

afterEach(() => {
  document.head.innerHTML = "";
  document.body.innerHTML = "";
  delete (window as any).ytInitialPlayerResponse;
});

describe("getPlayerResponse", () => {
  it("extracts from window.ytInitialPlayerResponse global", () => {
    (window as any).ytInitialPlayerResponse = {
      videoDetails: { videoId: "abc", title: "T", lengthSeconds: "10", author: "A" },
      streamingData: { formats: [] },
    };
    const r = getPlayerResponse();
    expect(r?.videoDetails?.videoId).toBe("abc");
  });

  it("extracts from inline <script> tag when global missing", () => {
    const s = document.createElement("script");
    s.setAttribute("type", "application/ld+json");
    s.textContent = 'var ytInitialPlayerResponse = {"videoDetails":{"videoId":"xyz","title":"U","lengthSeconds":"5","author":"B"}};';
    document.body.appendChild(s);
    const r = getPlayerResponse();
    expect(r?.videoDetails?.videoId).toBe("xyz");
  });

  it("returns null when neither source present", () => {
    expect(getPlayerResponse()).toBeNull();
  });

  it("handles minified script format ytInitialPlayerResponse={...};", () => {
    const s = document.createElement("script");
    s.setAttribute("type", "application/ld+json");
    s.textContent = 'window.ytInitialPlayerResponse={"videoDetails":{"videoId":"mm","title":"M","lengthSeconds":"1","author":"X"}};(function(){})();';
    document.body.appendChild(s);
    const r = getPlayerResponse();
    expect(r?.videoDetails?.videoId).toBe("mm");
  });

  it("returns null on malformed JSON in script", () => {
    const s = document.createElement("script");
    s.setAttribute("type", "application/ld+json");
    s.textContent = 'var ytInitialPlayerResponse = {not: valid};';
    document.body.appendChild(s);
    expect(getPlayerResponse()).toBeNull();
  });

  it("ignores non-matching scripts", () => {
    const s = document.createElement("script");
    s.setAttribute("type", "application/ld+json");
    s.textContent = 'console.log("hello")';
    document.body.appendChild(s);
    expect(getPlayerResponse()).toBeNull();
  });

  it("uses movie_player.getPlayerResponse() as last resort", () => {
    const mp = document.createElement("div");
    mp.id = "movie_player";
    (mp as any).getPlayerResponse = () => ({
      videoDetails: { videoId: "mp1", title: "MP", lengthSeconds: "2", author: "Y" },
    });
    document.body.appendChild(mp);
    const r = getPlayerResponse();
    expect(r?.videoDetails?.videoId).toBe("mp1");
  });

  it("prefers global over script parsing", () => {
    (window as any).ytInitialPlayerResponse = {
      videoDetails: { videoId: "global", title: "G", lengthSeconds: "1", author: "A" },
    };
    const s = document.createElement("script");
    s.setAttribute("type", "application/ld+json");
    s.textContent = 'var ytInitialPlayerResponse = {"videoDetails":{"videoId":"script","title":"S","lengthSeconds":"1","author":"A"}};';
    document.body.appendChild(s);
    expect(getPlayerResponse()?.videoDetails?.videoId).toBe("global");
  });
});
