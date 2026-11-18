"use server";
// Every export of this file is a public endpoint (D17): keep createOrder the only one.
import { headers } from "next/headers";
import { checkout, type CreateOrderResult } from "@/lib/checkout";
import { db } from "@/lib/db";
import { requestVisitor } from "@/lib/tracking";

export async function createOrder(input: unknown): Promise<CreateOrderResult> {
  return checkout(db, input, { ...requestVisitor(await headers()), secret: process.env.TRACKING_SECRET, now: new Date() });
}
