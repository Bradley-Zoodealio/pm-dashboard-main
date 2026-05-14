"use server";

import {
  listBucketDetail,
  listOccurrencesForPhrasing,
  type BucketDetail,
  type LineItemOccurrence,
} from "@/lib/db/bid-aggregates";

export async function fetchBucketDetail(bucketName: string): Promise<BucketDetail> {
  return listBucketDetail(bucketName);
}

export async function fetchPhrasingOccurrences(
  phrasingLower: string,
): Promise<LineItemOccurrence[]> {
  return listOccurrencesForPhrasing(phrasingLower);
}
