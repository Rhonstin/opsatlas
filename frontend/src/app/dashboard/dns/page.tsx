'use client';
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

export default function DnsRedirect() {
  const router = useRouter();
  useEffect(() => { router.replace('/dashboard/settings?tab=dns'); }, [router]);
  return null;
}
