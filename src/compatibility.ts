/** Bounded, product-independent transport validation. Native clients verify the
 * detached signature and make the final database admission decision. */
export interface SignedCompatibility {
  data: string;
  signature: string;
}
export function validateCompatibility(
  value: unknown,
  version: string,
): SignedCompatibility {
  const fail = (): never => {
    throw new Error("Invalid release compatibility metadata");
  };
  if (!value || typeof value !== "object" || Array.isArray(value))
    return fail();
  const { data, signature } = value as SignedCompatibility;
  if (
    typeof data !== "string" ||
    data.length > 48 * 1024 ||
    !/^[A-Za-z0-9+/]+={0,2}$/.test(data) ||
    typeof signature !== "string" ||
    signature.length < 1 ||
    signature.length > 4096
  )
    return fail();
  let release: Record<string, unknown>;
  try {
    release = JSON.parse(Buffer.from(data, "base64").toString("utf8"));
  } catch {
    return fail();
  }
  if (
    !release ||
    release.schemaVersion !== 1 ||
    release.version !== version ||
    typeof release.identifier !== "string" ||
    release.identifier.length > 200 ||
    !release.platforms ||
    typeof release.platforms !== "object" ||
    Object.keys(release.platforms).length > 32
  )
    return fail();
  const databases = release.databases as {
    schemaVersion?: number;
    stores?: Record<
      string,
      { floor: number; target: number; lineage: Record<string, string> }
    >;
  };
  if (
    !databases ||
    databases.schemaVersion !== 1 ||
    !databases.stores ||
    Object.keys(databases.stores).sort().join() !== "metrics,product,session"
  )
    return fail();
  for (const store of Object.values(databases.stores)) {
    if (
      !store ||
      !Number.isSafeInteger(store.floor) ||
      !Number.isSafeInteger(store.target) ||
      store.floor < 1 ||
      store.target < store.floor ||
      store.target - store.floor > 255 ||
      !store.lineage ||
      typeof store.lineage !== "object" ||
      Object.keys(store.lineage).length !== store.target - store.floor + 1
    )
      return fail();
    for (let v = store.floor; v <= store.target; v++) {
      if (!/^[0-9a-f]{64}$/.test(store.lineage[v] ?? "")) return fail();
    }
  }
  return { data, signature };
}
