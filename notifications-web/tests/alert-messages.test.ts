// @vitest-environment happy-dom
import { mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it } from "vitest";

import AlertMessages from "../components/AlertMessages.vue";
import { AlertsStore } from "../stores/AlertsStore";

beforeEach(() => {
  setActivePinia(createPinia());
});

describe("alert messages", () => {
  it("dedupes identical messages and dismisses individual alerts", async () => {
    const store = AlertsStore();
    store.showError("A");
    store.showError("A");
    store.showError("B");

    const wrapper = mount(AlertMessages);
    expect(wrapper.findAll('[role="alert"]')).toHaveLength(2);

    await wrapper.findAll("button")[0]!.trigger("click");

    const alerts = wrapper.findAll('[role="alert"]');
    expect(alerts).toHaveLength(1);
    expect(alerts[0]!.text()).toContain("B");
    expect(wrapper.text()).not.toContain("A");
  });
});
