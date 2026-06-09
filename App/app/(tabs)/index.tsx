import { useEffect } from 'react';
import { useRouter } from 'expo-router';

const router = useRouter()

useEffect(() => {
  router.replace('/loader');
}, [useRouter]);