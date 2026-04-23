'use client';
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

export default function ConnectionsRedirect() {
  const router = useRouter();
  useEffect(() => { router.replace('/dashboard/settings?tab=connections'); }, [router]);
  return null;
}
