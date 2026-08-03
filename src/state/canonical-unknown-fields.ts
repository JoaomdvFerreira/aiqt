const UNKNOWN_TOP_LEVEL_FIELDS: unique symbol = Symbol("aiqt.unknownTopLevelFields");

type JsonObject = Record<string, unknown>;
type ModelWithUnknownFields<T extends object> = T & {
  [UNKNOWN_TOP_LEVEL_FIELDS]?: JsonObject;
};

function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function attachUnknownTopLevelFields<T extends object>(
  model: T,
  raw: unknown,
): T {
  if (!isJsonObject(raw)) return model;

  const knownKeys = new Set(Object.keys(model));
  const unknownFields: JsonObject = {};
  for (const [key, value] of Object.entries(raw)) {
    if (!knownKeys.has(key)) {
      unknownFields[key] = value;
    }
  }

  if (Object.keys(unknownFields).length === 0) return model;

  Object.defineProperty(model, UNKNOWN_TOP_LEVEL_FIELDS, {
    value: unknownFields,
    enumerable: true,
    configurable: true,
  });
  return model;
}

export function mergeUnknownTopLevelFields<T extends object>(model: T): T {
  const unknownFields = (model as ModelWithUnknownFields<T>)[UNKNOWN_TOP_LEVEL_FIELDS];
  if (!unknownFields) return model;
  return { ...unknownFields, ...model };
}
