"use client";

import { useLinkStatus } from "next/link";

/**
 * Put inside a `<Link>` as its first child. While that link's navigation is pending it carries `data-pending`, which
 * the link's own CSS reads with `:has([data-pending])`. Admin pages have no loading.tsx on purpose: it would start
 * the stream, and an unknown order id would then answer 200 instead of 404.
 */
export default function LinkPending() {
  const { pending } = useLinkStatus();
  return <span hidden data-pending={pending || undefined} />;
}
