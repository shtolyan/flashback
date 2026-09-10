import { useEffect, useState } from "react";
import { Platform, Linking } from "react-native";
import type { Status, View } from "@flashback/contracts";
export type Location = {
  view: View;
  status: Status | "";
  q: string;
  page: number;
  bug: number | null;
};
const initial: Location = {
  view: "open",
  status: "",
  q: "",
  page: 1,
  bug: null,
};
function read(url: string): Location {
  const p = new URL(url).searchParams;
  return {
    view: (["open", "fixed", "archive"].includes(p.get("view") ?? "")
      ? p.get("view")
      : "open") as View,
    status: (p.get("status") ?? "") as Status | "",
    q: p.get("q") ?? "",
    page: Math.max(1, parseInt(p.get("page") ?? "1") || 1),
    bug: Number(p.get("bug")) || null,
  };
}
const web = Platform.OS === "web";
export function useLocation() {
  const [location, setLocation] = useState<Location>(initial);
  useEffect(() => {
    if (web) {
      setLocation(read(window.location.href));
      const pop = () => setLocation(read(window.location.href));
      window.addEventListener("popstate", pop);
      return () => window.removeEventListener("popstate", pop);
    }
    Linking.getInitialURL().then((url) => {
      if (url) setLocation(read(url));
    });
    const sub = Linking.addEventListener("url", (e) =>
      setLocation(read(e.url)),
    );
    return () => sub.remove();
  }, []);
  function set(patch: Partial<Location>, push = false) {
    setLocation((current) => {
      const next = { ...current, ...patch };
      if (web) {
        const params = new URLSearchParams();
        params.set("view", next.view);
        if (next.status) params.set("status", next.status);
        if (next.q) params.set("q", next.q);
        params.set("page", String(next.page));
        if (next.bug) params.set("bug", String(next.bug));
        window.history[push ? "pushState" : "replaceState"](
          {
            ...window.history.state,
            flashbackOverlay: push
              ? true
              : window.history.state?.flashbackOverlay,
          },
          "",
          `/?${params}`,
        );
      }
      return next;
    });
  }
  function close() {
    if (web && window.history.state?.flashbackOverlay) window.history.back();
    else set({ bug: null });
  }
  return { location, set, close };
}
