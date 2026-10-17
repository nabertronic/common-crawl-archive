export const COMMON_CRAWL_USER_AGENT = "CCBot";
export const COMMON_CRAWL_USER_AGENT_STRING = "CCBot/2.0";
const ROBOTS_TIMEOUT_MS = 12_000;

// Work caps for hostile robots.txt files. Content past the byte cap is ignored,
// over-long rule paths are dropped, and only the first MAX_RULES rules count.
const MAX_ROBOTS_BYTES = 512 * 1024;
const MAX_RULE_PATH_LENGTH = 2048;
const MAX_RULES = 10_000;

export type RobotsRule = {
  directive: "allow" | "disallow";
  path: string;
  line: number;
};

export type RobotsCheckResult =
  | {
      status: "allowed" | "blocked";
      robotsUrl: string;
      targetPath: string;
      userAgent: string;
      matchedRule?: RobotsRule;
      crawlDelay?: string;
      checkedAt: number;
    }
  | {
      status: "no-robots";
      robotsUrl: string;
      targetPath: string;
      userAgent: string;
      checkedAt: number;
    }
  | {
      status: "unavailable";
      robotsUrl?: string;
      userAgent: string;
      error: string;
      checkedAt: number;
    };

type RobotsGroup = {
  userAgents: string[];
  rules: RobotsRule[];
  crawlDelay?: string;
};

type ParsedRobots = {
  groups: RobotsGroup[];
};

type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

export function robotsUrlForTarget(targetUrl: string): { robotsUrl: string; targetPath: string } | undefined {
  const parsed = parseTargetUrl(targetUrl);
  if (!parsed) return undefined;
  try {
    return {
      robotsUrl: new URL("/robots.txt", parsed.origin).toString(),
      targetPath: `${parsed.pathname || "/"}${parsed.search}`
    };
  } catch {
    return undefined;
  }
}

export async function fetchRobotsStatus(
  targetUrl: string,
  signal?: AbortSignal,
  fetchImpl: FetchLike = fetch
): Promise<RobotsCheckResult> {
  const target = robotsUrlForTarget(targetUrl);
  const checkedAt = Date.now();
  if (!target) {
    return {
      status: "unavailable",
      userAgent: COMMON_CRAWL_USER_AGENT,
      error: "The URL could not be parsed.",
      checkedAt
    };
  }

  const requestSignal = createTimeoutSignal(signal, ROBOTS_TIMEOUT_MS);
  try {
    const response = await fetchImpl(target.robotsUrl, {
      headers: { Accept: "text/plain,*/*" },
      signal: requestSignal
    });

    if (response.status === 404 || response.status === 410) {
      return {
        status: "no-robots",
        robotsUrl: target.robotsUrl,
        targetPath: target.targetPath,
        userAgent: COMMON_CRAWL_USER_AGENT,
        checkedAt: Date.now()
      };
    }

    // The remote status code is deliberately not echoed back: the client only
    // learns that the file could not be read, not what the remote host answered.
    if (!response.ok) {
      return {
        status: "unavailable",
        robotsUrl: target.robotsUrl,
        userAgent: COMMON_CRAWL_USER_AGENT,
        error: "robots.txt could not be read from the target site.",
        checkedAt: Date.now()
      };
    }

    const parsed = parseRobotsTxt(await readCappedText(response));
    return evaluateRobots(parsed, target.targetPath, target.robotsUrl, Date.now());
  } catch (error) {
    if (signal?.aborted) throw error;
    return {
      status: "unavailable",
      robotsUrl: target.robotsUrl,
      userAgent: COMMON_CRAWL_USER_AGENT,
      error: describeRobotsFetchError(error, requestSignal),
      checkedAt: Date.now()
    };
  }
}

async function readCappedText(response: Response): Promise<string> {
  const bytes = new Uint8Array(await response.arrayBuffer());
  return new TextDecoder().decode(bytes.subarray(0, MAX_ROBOTS_BYTES));
}

export function parseRobotsTxt(text: string): ParsedRobots {
  const groups: RobotsGroup[] = [];
  let current: RobotsGroup | undefined;
  let sawRuleInCurrentGroup = false;
  let ruleCount = 0;

  text.split(/\r?\n/).forEach((rawLine, index) => {
    const line = rawLine.replace(/#.*/, "").trim();
    if (!line) return;

    const separator = line.indexOf(":");
    if (separator === -1) return;
    const field = line.slice(0, separator).trim().toLowerCase();
    const value = line.slice(separator + 1).trim();

    if (field === "user-agent") {
      if (!current || sawRuleInCurrentGroup) {
        current = { userAgents: [], rules: [] };
        groups.push(current);
        sawRuleInCurrentGroup = false;
      }
      current.userAgents.push(value.toLowerCase());
      return;
    }

    if (!current) return;

    if (field === "allow" || field === "disallow") {
      sawRuleInCurrentGroup = true;
      if (value.length > MAX_RULE_PATH_LENGTH || ruleCount >= MAX_RULES) return;
      ruleCount += 1;
      current.rules.push({
        directive: field,
        path: value,
        line: index + 1
      });
      return;
    }

    if (field === "crawl-delay" && value) {
      current.crawlDelay = value;
    }
  });

  return { groups };
}

export function evaluateRobots(
  parsed: ParsedRobots,
  targetPath: string,
  robotsUrl: string,
  checkedAt = Date.now()
): RobotsCheckResult {
  const groups = matchingGroups(parsed.groups, COMMON_CRAWL_USER_AGENT_STRING);
  const rules = groups.flatMap((group) => group.rules).filter((rule) => rule.path !== "");
  const matchedRule = strongestRule(rules, targetPath);
  const crawlDelay = groups.find((group) => group.crawlDelay)?.crawlDelay;

  return {
    status: matchedRule?.directive === "disallow" ? "blocked" : "allowed",
    robotsUrl,
    targetPath,
    userAgent: COMMON_CRAWL_USER_AGENT,
    matchedRule,
    crawlDelay,
    checkedAt
  };
}

// RFC 9309 section 2.2.1: a crawler matches the product token of its user agent
// (the part before "/") against each User-agent line, case-insensitively.
function matchingGroups(groups: RobotsGroup[], userAgent: string) {
  const productToken = userAgentProductToken(userAgent);
  const specific = groups.filter((group) =>
    group.userAgents.some((agent) => {
      const agentToken = userAgentProductToken(agent);
      return agentToken !== "" && agentToken !== "*" && agentToken === productToken;
    })
  );
  if (specific.length > 0) return specific;
  return groups.filter((group) => group.userAgents.includes("*"));
}

function userAgentProductToken(value: string) {
  return (value.split("/")[0] ?? "").trim().toLowerCase();
}

function strongestRule(rules: RobotsRule[], targetPath: string): RobotsRule | undefined {
  return rules
    .filter((rule) => robotsPatternMatches(rule.path, targetPath))
    .sort((a, b) => {
      const lengthDiff = patternSpecificity(b.path) - patternSpecificity(a.path);
      if (lengthDiff !== 0) return lengthDiff;
      if (a.directive === b.directive) return 0;
      return a.directive === "allow" ? -1 : 1;
    })[0];
}

/**
 * Matches a robots.txt path pattern (`*` wildcard, trailing `$` anchor) without
 * a RegExp, so hostile patterns cannot cause catastrophic backtracking.
 * Segments between wildcards are located greedily: taking the leftmost match
 * for each middle segment is always safe, and the final segment is checked
 * against the end of the path when anchored.
 */
function robotsPatternMatches(pattern: string, targetPath: string) {
  if (!pattern) return false;
  const anchoredToEnd = pattern.endsWith("$");
  const segments = (anchoredToEnd ? pattern.slice(0, -1) : pattern).split("*");

  const head = segments[0] ?? "";
  if (!targetPath.startsWith(head)) return false;
  if (segments.length === 1) return !anchoredToEnd || targetPath.length === head.length;

  const tail = segments[segments.length - 1] ?? "";
  let position = head.length;
  for (let index = 1; index < segments.length - 1; index += 1) {
    const segment = segments[index] ?? "";
    const found = targetPath.indexOf(segment, position);
    if (found === -1) return false;
    position = found + segment.length;
  }

  if (anchoredToEnd) {
    return targetPath.endsWith(tail) && targetPath.length - tail.length >= position;
  }
  return targetPath.indexOf(tail, position) !== -1;
}

function patternSpecificity(pattern: string) {
  return pattern.replaceAll("*", "").replace(/\$$/, "").length;
}

function parseTargetUrl(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return null;
  try {
    return new URL(trimmed);
  } catch {
    try {
      return new URL(`https://${trimmed}`);
    } catch {
      return null;
    }
  }
}

function createTimeoutSignal(parent: AbortSignal | undefined, timeoutMs: number): AbortSignal {
  const controller = new AbortController();
  const timeoutId = globalThis.setTimeout(() => controller.abort("timeout"), timeoutMs);
  const abort = () => controller.abort(parent?.reason);

  if (parent) {
    if (parent.aborted) {
      controller.abort(parent.reason);
    } else {
      parent.addEventListener("abort", abort, { once: true });
    }
  }

  controller.signal.addEventListener(
    "abort",
    () => {
      globalThis.clearTimeout(timeoutId);
      parent?.removeEventListener("abort", abort);
    },
    { once: true }
  );

  return controller.signal;
}

function describeRobotsFetchError(error: unknown, requestSignal: AbortSignal) {
  if (requestSignal.aborted && requestSignal.reason === "timeout") return "robots.txt request timed out.";
  if (error instanceof TypeError) {
    return "robots.txt could not be read from the target site.";
  }
  return error instanceof Error ? error.message : "robots.txt could not be checked.";
}
