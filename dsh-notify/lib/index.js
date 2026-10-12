// Host half: the plugin's Config schema is projected into a settings form by
// the Harness settings service (dsh 0.1.7+); no explicit namespace
// registration is needed. The browser half renders its own Notifications page,
// so the auto-generated form page is suppressed here.
import z from "@deepseek-ai/schemastery";

export const name = "dsh-notify";

export const Config = z.object({
  enabled: z.boolean().default(true),
  soundEnabled: z.boolean().default(true),
  volume: z.number().min(0).max(100).default(60),
  doneSound: z.union(["chime", "cascade"]).default("chime"),
  questionSound: z.union(["triple", "pulse"]).default("triple"),
  onlyWhenHidden: z.boolean().default(false)
});

/**
 * Suppress the auto-generated settings page for this plugin's Config: the
 * browser half contributes its own `settings.section` page. Soft-inject the
 * settings service so the plugin still loads without it.
 * @param ctx - Host plugin context.
 */
export function apply(ctx) {
  ctx.inject(["settings"], (child) => {
    child.effect(
      () => child.settings.configure({ auto: false }, ctx.fiber),
      "dsh-notify: settings page policy"
    );
  });
}
