import { describe, expect, it } from "vitest";
import { compileFlow, hashConfig } from "../src/compiler/compile";
import type { FlowEdge, FlowNode, FlowRecord } from "../src/compiler/types";

let y = 0;
const trigger = (id: string, data: Extract<FlowNode, { type: "trigger" }>["data"]): FlowNode =>
  ({ id, type: "trigger", position: { x: 0, y: y++ }, data });
const condition = (id: string, data: Extract<FlowNode, { type: "condition" }>["data"]): FlowNode =>
  ({ id, type: "condition", position: { x: 300, y: y++ }, data });
const action = (id: string, data: Extract<FlowNode, { type: "action" }>["data"]): FlowNode =>
  ({ id, type: "action", position: { x: 600, y: y++ }, data });
const edge = (source: string, target: string, sourceHandle = "out"): FlowEdge =>
  ({ id: `${source}-${sourceHandle}-${target}`, source, target, sourceHandle });

const flow = (nodes: FlowNode[], edges: FlowEdge[]): FlowRecord => ({
  id: "abc", name: "Test", enabled: true, mode: "restart", config_hash: null, graph: { nodes, edges },
});

const doorOpened = {
  kind: "device" as const,
  device_id: "dev1",
  card: {
    platform: "device", device_id: "dev1", domain: "binary_sensor", entity_id: "reg1",
    type: "opened", metadata: { secondary: false },
  },
};
const lightOn = action("light", { kind: "service", service: "light.turn_on", target: { entity_id: "light.hal" } });

describe("compileFlow", () => {
  it("compiles a linear flow with a device trigger", () => {
    const result = compileFlow(flow(
      [trigger("t1", doorOpened), lightOn, action("wait", { kind: "delay", minutes: 5 })],
      [edge("t1", "light"), edge("light", "wait")],
    ));
    expect(result.errors).toEqual([]);
    expect(result.config).toEqual({
      id: "flowey_abc",
      alias: "Test",
      description: expect.any(String),
      mode: "restart",
      triggers: [{ trigger: "device", device_id: "dev1", domain: "binary_sensor", entity_id: "reg1", type: "opened", id: "t1" }],
      conditions: [],
      actions: [
        { action: "light.turn_on", target: { entity_id: "light.hal" } },
        { delay: { minutes: 5 } },
      ],
    });
  });

  it("compiles a yes/no condition to if/then/else and sun offsets", () => {
    const result = compileFlow(flow(
      [
        trigger("t1", { kind: "sun", event: "sunset", offset: "-0:30" }),
        condition("c1", { kind: "state", entity_id: "person.paul", state: "home" }),
        lightOn,
        action("notify", { kind: "service", service: "notify.notify", data: { message: "Niemand thuis" } }),
      ],
      [edge("t1", "c1"), edge("c1", "light", "yes"), edge("c1", "notify", "no")],
    ));
    expect(result.errors).toEqual([]);
    expect(result.config.triggers).toEqual([{ trigger: "sun", event: "sunset", offset: "-00:30:00", id: "t1" }]);
    expect(result.config.actions).toEqual([{
      if: [{ condition: "state", entity_id: "person.paul", state: "home" }],
      then: [{ action: "light.turn_on", target: { entity_id: "light.hal" } }],
      else: [{ action: "notify.notify", data: { message: "Niemand thuis" } }],
    }]);
  });

  it("uses a plain condition step when only the yes path is connected", () => {
    const result = compileFlow(flow(
      [trigger("t1", doorOpened), condition("c1", { kind: "time", after: "22:00", weekdays: ["sat", "sun"] }), lightOn],
      [edge("t1", "c1"), edge("c1", "light", "yes")],
    ));
    expect(result.config.actions).toEqual([
      { condition: "time", after: "22:00:00", weekday: ["sat", "sun"] },
      { action: "light.turn_on", target: { entity_id: "light.hal" } },
    ]);
  });

  it("negates the condition when only the no path is connected", () => {
    const result = compileFlow(flow(
      [trigger("t1", doorOpened), condition("c1", { kind: "sun", after: "sunset" }), lightOn],
      [edge("t1", "c1"), edge("c1", "light", "no")],
    ));
    expect(result.config.actions).toEqual([{
      if: [{ condition: "not", conditions: [{ condition: "sun", after: "sunset" }] }],
      then: [{ action: "light.turn_on", target: { entity_id: "light.hal" } }],
    }]);
  });

  it("runs multiple outgoing edges in parallel, ordered top to bottom", () => {
    const result = compileFlow(flow(
      [trigger("t1", doorOpened), lightOn, action("wait", { kind: "delay", seconds: 10 })],
      [edge("t1", "wait"), edge("t1", "light")],
    ));
    expect(result.config.actions).toEqual([{
      parallel: [
        { sequence: [{ action: "light.turn_on", target: { entity_id: "light.hal" } }] },
        { sequence: [{ delay: { seconds: 10 } }] },
      ],
    }]);
  });

  it("merges triggers that lead to the same card (A or B → X)", () => {
    const result = compileFlow(flow(
      [trigger("t1", doorOpened), trigger("t2", { kind: "time", at: "7:00" }), lightOn],
      [edge("t1", "light"), edge("t2", "light")],
    ));
    expect(result.errors).toEqual([]);
    expect(result.config.triggers).toHaveLength(2);
    expect(result.config.triggers[1]).toEqual({ trigger: "time", at: "07:00:00", id: "t2" });
    expect(result.config.actions).toEqual([{ action: "light.turn_on", target: { entity_id: "light.hal" } }]);
  });

  it("uses choose on trigger id when triggers lead to different paths", () => {
    const result = compileFlow(flow(
      [
        trigger("t1", doorOpened),
        trigger("t2", { kind: "time", at: "07:00", weekdays: ["mon", "tue", "wed", "thu", "fri"] }),
        lightOn,
        action("wait", { kind: "delay", seconds: 3 }),
      ],
      [edge("t1", "light"), edge("t2", "wait")],
    ));
    expect(result.config.actions).toEqual([{
      choose: [
        { conditions: [{ condition: "trigger", id: "t1" }], sequence: [{ action: "light.turn_on", target: { entity_id: "light.hal" } }] },
        {
          conditions: [{ condition: "trigger", id: "t2" }],
          sequence: [
            { condition: "time", weekday: ["mon", "tue", "wed", "thu", "fri"] },
            { delay: { seconds: 3 } },
          ],
        },
      ],
    }]);
  });

  it("rejects merges after a non-trigger node", () => {
    const result = compileFlow(flow(
      [trigger("t1", doorOpened), action("a", { kind: "delay", seconds: 1 }), action("b", { kind: "delay", seconds: 2 }), lightOn],
      [edge("t1", "a"), edge("t1", "b"), edge("a", "light"), edge("b", "light")],
    ));
    expect(result.errors.map(e => e.nodeId)).toContain("light");
  });

  it("detects cycles", () => {
    const result = compileFlow(flow(
      [trigger("t1", doorOpened), action("a", { kind: "delay", seconds: 1 }), action("b", { kind: "delay", seconds: 2 })],
      [edge("t1", "a"), edge("a", "b"), edge("b", "a")],
    ));
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it("reports incomplete cards and a missing trigger", () => {
    expect(compileFlow(flow([lightOn], [])).errors.map(e => e.message)).toContain("Voeg minstens één trigger toe (ALS…).");
    const result = compileFlow(flow(
      [trigger("t1", { kind: "device" }), action("s", { kind: "service" })],
      [edge("t1", "s")],
    ));
    expect(result.errors.map(e => e.nodeId).sort()).toEqual(["s", "t1"]);
  });
});

describe("weather, presence and notify cards", () => {
  const only = (node: FlowNode) => {
    const next = action("next", { kind: "delay", seconds: 1 });
    const edges = node.type === "trigger" ? [edge(node.id, "next")] : [edge("t", node.id), edge(node.id, "next", "yes")];
    const nodes = node.type === "trigger" ? [node, next] : [trigger("t", { kind: "time", at: "08:00" }), node, next];
    return compileFlow(flow(nodes, edges));
  };

  it("weather condition trigger and numeric attribute condition", () => {
    const rain = only(trigger("w", { kind: "weather", entity_id: "weather.home", conditions: ["rainy", "pouring"] }));
    expect(rain.config.triggers).toEqual([{ trigger: "state", entity_id: "weather.home", to: ["rainy", "pouring"], id: "w" }]);

    const warm = only(condition("c", { kind: "weather", entity_id: "weather.home", measure: "temperature", above: "25" }));
    expect(warm.config.actions[0]).toEqual({ condition: "numeric_state", entity_id: "weather.home", attribute: "temperature", above: 25 });
  });

  it("presence triggers for persons and first/last person", () => {
    const home = only(trigger("p", { kind: "presence", event: "arrive", persons: ["person.paul"], zone: "zone.home" }));
    expect(home.config.triggers[0]).toEqual({ trigger: "state", entity_id: ["person.paul"], to: "home", id: "p" });

    const work = only(trigger("p", { kind: "presence", event: "leave", persons: ["person.paul"], zone: "zone.werk", zone_state: "Werk" }));
    expect(work.config.triggers[0]).toEqual({ trigger: "state", entity_id: ["person.paul"], from: "Werk", id: "p" });

    const last = only(trigger("p", { kind: "presence", event: "last_leave" }));
    expect(last.config.triggers[0]).toEqual({
      trigger: "state", entity_id: "zone.home", to: "0", not_from: ["unavailable", "unknown"], id: "p",
    });
  });

  it("presence conditions", () => {
    const someone = only(condition("c", { kind: "presence", check: "someone" }));
    expect(someone.config.actions[0]).toEqual({ condition: "numeric_state", entity_id: "zone.home", above: 0 });
    const away = only(condition("c", { kind: "presence", check: "persons_not_in", persons: ["person.a", "person.b"] }));
    expect(away.config.actions[0]).toEqual({
      condition: "not",
      conditions: [{ condition: "state", entity_id: ["person.a", "person.b"], match: "any", state: "home" }],
    });
  });

  it("notify to HA, a legacy notify service and a notify entity", () => {
    const compileNotify = (target: string) => compileFlow(flow(
      [trigger("t", doorOpened), action("n", { kind: "notify", target, title: "Let op", message: "Deur open" })],
      [edge("t", "n")],
    )).config.actions[0];
    expect(compileFlow(flow(
      [trigger("t", doorOpened), action("n", { kind: "notify", title: "  ", message: "Hoi" })], [edge("t", "n")],
    )).config.actions[0]).toEqual({ action: "persistent_notification.create", data: { message: "Hoi" } });
    expect(compileNotify("persistent")).toEqual({ action: "persistent_notification.create", data: { title: "Let op", message: "Deur open" } });
    expect(compileNotify("service:notify.mobile_app_pixel")).toEqual({ action: "notify.mobile_app_pixel", data: { title: "Let op", message: "Deur open" } });
    expect(compileNotify("entity:notify.kantoor")).toEqual({
      action: "notify.send_message", target: { entity_id: "notify.kantoor" }, data: { title: "Let op", message: "Deur open" },
    });
  });

  it("reports incomplete new cards", () => {
    const result = compileFlow(flow(
      [trigger("w", { kind: "weather" }), action("n", { kind: "notify", message: "" })],
      [edge("w", "n")],
    ));
    expect(result.errors.map(e => e.message)).toEqual(["Kies een weerbron.", "Vul een bericht in."]);
  });
});

describe("webhook card", () => {
  const compileWebhook = (data: Record<string, unknown>) => compileFlow(flow(
    [trigger("t", doorOpened), action("w", { kind: "webhook", ...data } as any)], [edge("t", "w")],
  ));

  it("builds a Homey webhook URL (GET, encoded event and tag)", () => {
    const result = compileWebhook({ mode: "homey", webhook_id: "abc123", homey_id: " 5f1e2d3c4b5a69788796a5b4 ", event: "hallamp Beneden", tag: "aan & uit" });
    expect(result.errors).toEqual([]);
    expect(result.config.actions[0]).toEqual({
      action: "ha_flow_builder.call_webhook",
      data: {
        url: "https://webhooks.athom.com/webhook/abc123?homey=5f1e2d3c4b5a69788796a5b4&event=hallamp%20Beneden&tag=aan%20%26%20uit",
        method: "GET",
      },
    });
  });

  it("leaves templates in a Homey tag untouched", () => {
    const result = compileWebhook({ mode: "homey", webhook_id: "w", homey_id: "h", event: "temp", tag: "{{ states('sensor.t') }}" });
    expect((result.config.actions[0] as any).data.url)
      .toBe("https://webhooks.athom.com/webhook/w?homey=h&event=temp&tag={{ states('sensor.t') }}");
  });

  it("custom POST with JSON body adds a Content-Type header", () => {
    const result = compileWebhook({
      mode: "custom", url: "http://192.168.1.20/api/scene", method: "POST",
      headers: [{ name: "Authorization", value: "Bearer abc" }, { name: " ", value: "ignored" }],
      body: '{"scene": "avond"}', body_type: "json",
    });
    expect(result.config.actions[0]).toEqual({
      action: "ha_flow_builder.call_webhook",
      data: {
        url: "http://192.168.1.20/api/scene", method: "POST",
        headers: { Authorization: "Bearer abc", "Content-Type": "application/json" },
        payload: '{"scene": "avond"}',
      },
    });
  });

  it("drops the body for GET and accepts a JSON body with templates", () => {
    const get = compileWebhook({ mode: "custom", url: "https://example.com/hook", method: "GET", body: "{bad" });
    expect((get.config.actions[0] as any).data).toEqual({ url: "https://example.com/hook", method: "GET" });
    const templated = compileWebhook({ mode: "custom", url: "https://example.com", body: '{"t": {{ states("sensor.t") }} }' });
    expect(templated.errors).toEqual([]);
  });

  it("reports missing or invalid fields", () => {
    const messages = (data: Record<string, unknown>) => compileWebhook(data).errors.map(e => e.message);
    expect(messages({ mode: "homey", homey_id: "h", event: "x" })).toEqual(["Vul het webhook-ID in (het deel na /webhook/ in de Homey-URL)."]);
    expect(messages({ mode: "homey", webhook_id: "w", event: "x" })).toEqual(["Vul je Homey-ID in."]);
    expect(messages({ mode: "homey", webhook_id: "w", homey_id: "abc" })).toEqual(["Vul de eventnaam in die je in Homey gebruikt."]);
    expect(messages({ mode: "custom", url: "ftp://nas" })).toEqual(["Vul een URL in die begint met http:// of https://."]);
    expect(messages({ mode: "custom", url: "https://x.nl", body: "{bad" })).toEqual(["De body is geen geldige JSON."]);
  });
});

describe("light card", () => {
  const lamps = ["light.bijkeuken_links", "light.bijkeuken_rechts"];
  const compileLight = (data: Record<string, unknown>) => compileFlow(flow(
    [trigger("t", doorOpened), action("l", { kind: "light", entities: lamps, ...data } as any)], [edge("t", "l")],
  ));
  const step = (data: Record<string, unknown>) => compileLight(data).config.actions[0];
  const target = { entity_id: lamps };

  it("turns on, optionally with brightness, transition and colour temperature", () => {
    expect(step({ action: "on" })).toEqual({ action: "light.turn_on", target });
    expect(step({ action: "on", brightness: "40", transition: 2, color_temp: 2700 })).toEqual({
      action: "light.turn_on", target, data: { brightness_pct: 40, color_temp_kelvin: 2700, transition: 2 },
    });
  });

  it("dims to a fixed percentage", () => {
    expect(step({ action: "dim", brightness: 15 })).toEqual({ action: "light.turn_on", target, data: { brightness_pct: 15 } });
  });

  it("makes brighter or darker by a relative step", () => {
    expect(step({ action: "step", step: 20 })).toEqual({ action: "light.turn_on", target, data: { brightness_step_pct: 20 } });
    expect(step({ action: "step", step: -20, color_temp: 3000 })).toEqual({
      action: "light.turn_on", target, data: { brightness_step_pct: -20 },
    });
  });

  it("turns off (with transition) and toggles", () => {
    expect(step({ action: "off", transition: 3, brightness: 50 })).toEqual({ action: "light.turn_off", target, data: { transition: 3 } });
    expect(step({ action: "toggle" })).toEqual({ action: "light.toggle", target });
  });

  it("reports missing lamps, brightness and step", () => {
    const messages = (data: Record<string, unknown>) => compileLight(data).errors.map(e => e.message);
    expect(messages({ entities: [] })).toEqual(["Kies minstens één lamp."]);
    expect(messages({ action: "dim" })).toEqual(["Kies een helderheid."]);
    expect(messages({ action: "dim", brightness: 150 })).toEqual(["De helderheid moet tussen 1 en 100 % liggen."]);
    expect(messages({ action: "step", step: 0 })).toEqual(["Kies hoeveel procent feller of donkerder."]);
  });
});

describe("webhook trigger", () => {
  const compileHook = (data: Record<string, unknown>) => compileFlow(flow(
    [trigger("h", { kind: "webhook", ...data } as any), lightOn], [edge("h", "light")],
  ));

  it("compiles with HA defaults (POST/PUT, local only)", () => {
    expect(compileHook({ webhook_id: "flowey_abc123" }).config.triggers).toEqual([
      { trigger: "webhook", webhook_id: "flowey_abc123", allowed_methods: ["POST", "PUT"], local_only: true, id: "h" },
    ]);
  });

  it("uses the chosen methods and internet access", () => {
    expect(compileHook({ webhook_id: "x", methods: ["GET", "POST"], local_only: false }).config.triggers[0]).toEqual({
      trigger: "webhook", webhook_id: "x", allowed_methods: ["GET", "POST"], local_only: false, id: "h",
    });
  });

  it("rejects missing or unsafe ids", () => {
    expect(compileHook({}).errors.map(e => e.message)).toEqual(["Het webhook-ID mag alleen letters, cijfers, - en _ bevatten."]);
    expect(compileHook({ webhook_id: "a/b" }).errors).toHaveLength(1);
  });
});

describe("wait card", () => {
  const noMotion = { kind: "state" as const, entity_id: "binary_sensor.pir", to: "off", for: { minutes: 2 } };
  const lightOff = action("off", { kind: "service", service: "light.turn_off", target: { entity_id: "light.hal" } });
  const notify = action("notify", { kind: "notify", message: "Nog steeds beweging" });
  const wait = (data: Record<string, unknown>) => action("w", { kind: "wait", ...data } as any);
  const waitFlow = (data: Record<string, unknown>, edges: FlowEdge[], extra: FlowNode[] = []) => compileFlow(flow(
    [trigger("t", doorOpened), lightOn, wait(data), lightOff, ...extra],
    [edge("t", "light"), edge("light", "w"), ...edges],
  ));
  const waitStep = { wait_for_trigger: [{ trigger: "state", entity_id: "binary_sensor.pir", to: "off", for: { minutes: 2 } }] };
  const offStep = { action: "light.turn_off", target: { entity_id: "light.hal" } };

  it("waits without a maximum, then continues", () => {
    const result = waitFlow({ trigger: noMotion }, [edge("w", "off", "done")]);
    expect(result.errors).toEqual([]);
    expect(result.config.actions).toEqual([
      { action: "light.turn_on", target: { entity_id: "light.hal" } },
      waitStep,
      offStep,
    ]);
  });

  it("stops at the maximum when only 'gebeurd' is connected", () => {
    const result = waitFlow({ trigger: noMotion, timeout: { minutes: 30 } }, [edge("w", "off", "done")]);
    expect(result.config.actions.slice(1)).toEqual([
      { ...waitStep, timeout: { minutes: 30 }, continue_on_timeout: false },
      offStep,
    ]);
  });

  it("branches on timeout when both outputs are connected", () => {
    const result = waitFlow(
      { trigger: noMotion, timeout: { minutes: 30 } },
      [edge("w", "off", "done"), edge("w", "notify", "timeout")],
      [notify],
    );
    expect(result.config.actions.slice(1)).toEqual([
      { ...waitStep, timeout: { minutes: 30 }, continue_on_timeout: true },
      {
        if: [{ condition: "template", value_template: "{{ wait.trigger is none }}" }],
        then: [{ action: "persistent_notification.create", data: { message: "Nog steeds beweging" } }],
        else: [offStep],
      },
    ]);
  });

  it("reports a missing trigger and warns about an unused timeout path", () => {
    expect(waitFlow({}, [edge("w", "off", "done")]).errors.map(e => e.message)).toEqual(["Kies waarop gewacht moet worden."]);
    const warned = waitFlow({ trigger: noMotion }, [edge("w", "notify", "timeout")], [notify]);
    expect(warned.warnings.map(w => w.message)).toContain("Stel een maximale wachttijd in; anders wordt 'tijd verstreken' nooit gebruikt.");
  });
});

describe("timer cards", () => {
  const TIMER = "timer.nalooptijd_bijkeuken";

  it("starts a timer (optionally with a duration) and reacts when it finishes", () => {
    const start = compileFlow(flow(
      [trigger("t", doorOpened), action("s", { kind: "timer", entity_id: TIMER, action: "start", duration: { minutes: 2 } })],
      [edge("t", "s")],
    ));
    expect(start.config.actions).toEqual([{ action: "timer.start", target: { entity_id: TIMER }, data: { duration: { minutes: 2 } } }]);

    const finished = compileFlow(flow(
      [trigger("f", { kind: "timer_finished", entity_id: TIMER }), lightOn], [edge("f", "light")],
    ));
    expect(finished.config.triggers).toEqual([
      { trigger: "event", event_type: "timer.finished", event_data: { entity_id: TIMER }, id: "f" },
    ]);
  });

  it("cancels without a duration and checks whether a timer runs", () => {
    const result = compileFlow(flow(
      [
        trigger("t", doorOpened),
        condition("c", { kind: "timer", entity_id: TIMER, check: "not_running" }),
        action("x", { kind: "timer", entity_id: TIMER, action: "cancel", duration: { minutes: 5 } }),
      ],
      [edge("t", "c"), edge("c", "x", "yes")],
    ));
    expect(result.config.actions).toEqual([
      { condition: "not", conditions: [{ condition: "state", entity_id: TIMER, state: "active" }] },
      { action: "timer.cancel", target: { entity_id: TIMER } },
    ]);
  });

  it("requires a timer", () => {
    const result = compileFlow(flow([trigger("f", { kind: "timer_finished" }), lightOn], [edge("f", "light")]));
    expect(result.errors.map(e => e.message)).toEqual(["Kies een timer."]);
  });
});

describe("repeat card", () => {
  const blink = action("blink", { kind: "service", service: "light.toggle", target: { entity_id: "light.hal" } });
  const pause = action("pause", { kind: "delay", seconds: 1 });
  const repeatFlow = (data: Record<string, unknown>, extra: FlowNode[] = [], edges: FlowEdge[] = []) => compileFlow(flow(
    [trigger("t", doorOpened), action("r", { kind: "repeat", ...data } as any), blink, pause, ...extra],
    [edge("t", "r"), edge("r", "blink", "loop"), edge("blink", "pause"), ...edges],
  ));
  const body = [{ action: "light.toggle", target: { entity_id: "light.hal" } }, { delay: { seconds: 1 } }];

  it("repeats a fixed number of times, then continues via 'klaar'", () => {
    const result = repeatFlow({ mode: "count", count: "3" }, [lightOn], [edge("r", "light", "done")]);
    expect(result.errors).toEqual([]);
    expect(result.config.actions).toEqual([
      { repeat: { count: 3, sequence: body } },
      { action: "light.turn_on", target: { entity_id: "light.hal" } },
    ]);
  });

  it("repeats while/until a condition, with a safety maximum", () => {
    const doorOpen = { kind: "state" as const, entity_id: "binary_sensor.deur", state: "on" };
    expect(repeatFlow({ mode: "while", condition: doorOpen, max: 5 }).config.actions).toEqual([{
      repeat: {
        while: [{ condition: "state", entity_id: "binary_sensor.deur", state: "on" }, { condition: "template", value_template: "{{ repeat.index <= 5 }}" }],
        sequence: body,
      },
    }]);
    expect(repeatFlow({ mode: "until", condition: doorOpen }).config.actions).toEqual([{
      repeat: {
        until: [{ condition: "or", conditions: [
          { condition: "state", entity_id: "binary_sensor.deur", state: "on" },
          { condition: "template", value_template: "{{ repeat.index >= 10 }}" },
        ] }],
        sequence: body,
      },
    }]);
  });

  it("reports an empty loop, a bad count and a missing condition", () => {
    const empty = compileFlow(flow([trigger("t", doorOpened), action("r", { kind: "repeat", count: 2 } as any)], [edge("t", "r")]));
    expect(empty.errors.map(e => e.message)).toContain("Verbind de uitgang 'herhaal' met de kaarten die herhaald moeten worden.");
    expect(repeatFlow({ count: 0 }).errors.map(e => e.message)).toEqual(["Vul een aantal keer in (1–1000)."]);
    expect(repeatFlow({ mode: "until" }).errors.map(e => e.message)).toEqual(["Kies de voorwaarde voor de herhaling."]);
  });
});

describe("hashConfig", () => {
  it("ignores key order", () => {
    expect(hashConfig({ a: 1, b: [{ c: 2, d: 3 }] })).toBe(hashConfig({ b: [{ d: 3, c: 2 }], a: 1 }));
    expect(hashConfig({ a: 1 })).not.toBe(hashConfig({ a: 2 }));
  });
});
