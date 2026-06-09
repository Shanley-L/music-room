import { Text, View, StyleSheet } from 'react-native';
import Loader from '@/components/loader';

import { useRouter } from 'expo-router';


import { useEffect } from 'react';

export default function Index() {
    const router = useRouter()

    useEffect(() => {
        const timer = setTimeout(() => {
            router.replace('/home')
        }, 1000)

        return () => clearTimeout(timer)
    }, [router])

    return (
        <View style={styles.container}>
            <Loader />
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: '#25292e',
        alignItems: 'center',
        justifyContent: 'center',
    },
    text: {
        color: '#fff',
    },
});
