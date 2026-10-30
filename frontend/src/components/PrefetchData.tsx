import { USE_FIXTURES } from "@/lib/api";

/**
 * Starts a page's API requests from inline script in the static HTML, so data downloads while
 * the JavaScript does instead of after it. `{id}` in a URL is replaced with the page's `?id=`
 * value; the data layer picks the responses up by exact URL (see takePrefetched in lib/api.ts).
 * Skipped in fixture mode, which reads /data/ rather than /api/.
 */
export function PrefetchData({ urls }: { urls: string[] }) {
  if (USE_FIXTURES) return null;
  const code = `(function(){try{var id=new URLSearchParams(location.search).get("id");var w=window;w.__spxPrefetch=w.__spxPrefetch||{};${JSON.stringify(
    urls,
  )}.forEach(function(t){if(t.indexOf("{id}")>=0){if(!id||!/^[a-z0-9][a-z0-9._-]{0,95}$/.test(id))return;t=t.split("{id}").join(encodeURIComponent(id));}w.__spxPrefetch[t]=fetch(t,{headers:{accept:"application/json"}});});}catch(e){}})();`;
  return <script dangerouslySetInnerHTML={{ __html: code }} />;
}
