import {
  createTranslate,
  type MessageKey,
  type MessageParams,
} from "../src/i18n/messages";

type ParamsFor<K extends MessageKey> = K extends keyof MessageParams
  ? MessageParams[K]
  : undefined;

export function uiText<K extends MessageKey>(
  locale: "ja" | "en",
  key: K,
  ...args: ParamsFor<K> extends undefined ? [] : [ParamsFor<K>]
): string {
  const t = createTranslate(locale);
  if (args.length === 0) {
    return t(key);
  }
  return t(key, args[0] as NonNullable<ParamsFor<K>>);
}
