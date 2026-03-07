import { openDB, DBSchema } from 'idb';
import { ClienteOffline, ProductoOffline, ConfiguracionOffline } from '@/lib/types/sync';
import { getSyncData } from '@/lib/actions/sync';

interface ViajanteDB extends DBSchema {
    config: {
        key: string;
        value: ConfiguracionOffline;
    };
    productos: {
        key: string;
        value: ProductoOffline;
        indexes: { 'by-nombre': string };
    };
    clientes: {
        key: string;
        value: ClienteOffline;
    };
    sync_meta: {
        key: string;
        value: { lastSync: string };
    };
    pedidos_cola: {
        key: string;
        value: {
            id: string; // generated uuid
            payload: any;
            createdAt: string;
        };
    };
}

const DB_NAME = 'viajante-db';
const DB_VERSION = 1;

export async function initDB() {
    return openDB<ViajanteDB>(DB_NAME, DB_VERSION, {
        upgrade(db) {
            if (!db.objectStoreNames.contains('config')) {
                db.createObjectStore('config');
            }
            if (!db.objectStoreNames.contains('productos')) {
                const store = db.createObjectStore('productos', { keyPath: 'id' });
                store.createIndex('by-nombre', 'nombre');
            }
            if (!db.objectStoreNames.contains('clientes')) {
                db.createObjectStore('clientes', { keyPath: 'id' });
            }
            if (!db.objectStoreNames.contains('sync_meta')) {
                db.createObjectStore('sync_meta');
            }
            if (!db.objectStoreNames.contains('pedidos_cola')) {
                db.createObjectStore('pedidos_cola', { keyPath: 'id' });
            }
        },
    });
}

export async function syncCatalogFromServer(vendedorId?: string) {
    try {
        const data = await getSyncData(vendedorId);
        const db = await initDB();

        const tx = db.transaction(['productos', 'clientes', 'config', 'sync_meta'], 'readwrite');

        // Clear old data (optional, or smart merge? Clearing is safer for "Base Catalog" strategy)
        await tx.objectStore('productos').clear();
        await tx.objectStore('clientes').clear();
        await tx.objectStore('config').clear();

        // Bulk insert
        // Promise.all is faster for IDB
        const prodStore = tx.objectStore('productos');
        for (const p of data.productos) {
            prodStore.put(p);
        }

        const clientStore = tx.objectStore('clientes');
        for (const c of data.clientes) {
            clientStore.put(c);
        }

        if (data.config) {
            tx.objectStore('config').put(data.config, 'global');
        }

        tx.objectStore('sync_meta').put({ lastSync: new Date().toISOString() }, 'meta');

        await tx.done;
        return { success: true, count: data.productos.length };
    } catch (error) {
        console.error("Sync Failed", error);
        return { success: false, error };
    }
}

export async function searchProductosOffline(query: string) {
    const db = await initDB();
    // IndexedDB simple search (full scan if no full text search index)
    // For small catalogs (<5000) full scan is fast enough usually.
    const all = await db.getAll('productos');
    const q = query.toLowerCase();

    return all.filter(p =>
        p.nombre.toLowerCase().includes(q) ||
        p.sku.toLowerCase().includes(q)
    ).slice(0, 50);
}

export async function getClienteOffline(id: string) {
    const db = await initDB();
    return db.get('clientes', id);
}

export async function getConfigOffline() {
    const db = await initDB();
    return db.get('config', 'global');
}
