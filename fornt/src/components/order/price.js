import React, { useCallback, useEffect, useState } from 'react';
import { fetchJson } from '../../api';
import { handlePriceRowEnter } from '../common/priceNavigation';
import './price.css';

const todayString = () => {
    const now = new Date();
    now.setMinutes(now.getMinutes() - now.getTimezoneOffset());
    return now.toISOString().split('T')[0];
};

const emptyByBillFilters = { startDate: todayString(), endDate: todayString(), product: '' };
const emptyBulkFilters = { startDate: todayString(), endDate: todayString() };

// --- Top section: pick a product -> one row per order bill that has it, with
// Price and Quantity editable inline (save-on-blur, same as the rest of the app).
const ByBillSection = () => {
    const [filters, setFilters] = useState(emptyByBillFilters);
    const [rows, setRows] = useState([]); // { orderId, itemId, billNo, customerName, price, quantity, order }
    const [loading, setLoading] = useState(false);
    const [status, setStatus] = useState('Pick a product to see its bills.');

    const update = (key, value) => setFilters((current) => ({ ...current, [key]: value }));

    const loadRows = useCallback(async (activeFilters) => {
        const productName = activeFilters.product.trim();
        if (!productName) {
            setRows([]);
            setStatus('Pick a product first.');
            return;
        }
        setLoading(true);
        setStatus('');
        const params = new URLSearchParams();
        if (activeFilters.startDate) params.set('startDate', activeFilters.startDate);
        if (activeFilters.endDate) params.set('endDate', activeFilters.endDate);
        params.set('product', productName);
        try {
            const orders = await fetchJson(`/api/orders?${params.toString()}`);
            const term = productName.toLowerCase();
            const built = orders
                .map((order) => {
                    const item = (order.products || []).find((p) => (p.name || '').toLowerCase() === term);
                    if (!item) return null;
                    return {
                        orderId: order._id,
                        itemId: item._id,
                        billNo: order.bill_details?.order_sno || '—',
                        customerName: order.customer?.name || '—',
                        price: item.single_price ?? '',
                        quantity: item.quantity ?? '',
                        order,
                    };
                })
                .filter(Boolean);
            setRows(built);
            setStatus(built.length ? '' : 'No order bills have this product in the selected date range.');
        } catch (error) {
            setRows([]);
            setStatus(error.message);
        } finally {
            setLoading(false);
        }
    }, []);

    const submitFilter = (event) => { event.preventDefault(); loadRows(filters); };

    const editRow = (index, key, value) => {
        setRows((current) => current.map((row, i) => (i === index ? { ...row, [key]: value } : row)));
    };

    // Persist one row's edited price/quantity into its order bill, reusing the normal
    // order update endpoint — the backend recomputes the line amount and totals itself.
    const saveRow = async (index) => {
        const row = rows[index];
        if (!row) return;
        const updatedProducts = (row.order.products || []).map((p) => (
            p._id === row.itemId
                ? { ...p, single_price: Number(row.price) || 0, quantity: Number(row.quantity) || 0 }
                : p
        ));
        const payload = {
            customer: row.order.customer,
            bill_details: row.order.bill_details,
            products: updatedProducts,
        };
        try {
            const updated = await fetchJson(`/api/orders/${row.orderId}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
            });
            const item = (updated.products || []).find((p) => p._id === row.itemId) || {};
            setRows((current) => current.map((r, i) => (
                i === index ? { ...r, order: updated, price: item.single_price ?? r.price, quantity: item.quantity ?? r.quantity } : r
            )));
            setStatus(`Saved — bill ${row.billNo} (${row.customerName}) updated.`);
        } catch (error) {
            setStatus(error.message);
        }
    };

    return (
        <section className="price-card">
            <header className="price-header">
                <p className="price-eyebrow">By product</p>
                <h1>Update price / quantity per order bill</h1>
                <p>Pick a product to list every order bill that has it, with price and quantity editable per bill.</p>
            </header>

            <form className="price-filters" onSubmit={submitFilter}>
                <label><span>Start date</span>
                    <input type="date" value={filters.startDate} max={filters.endDate || undefined} onChange={(e) => update('startDate', e.target.value)} />
                </label>
                <label><span>End date</span>
                    <input type="date" value={filters.endDate} min={filters.startDate || undefined} onChange={(e) => update('endDate', e.target.value)} />
                </label>
                <label><span>Product name</span>
                    <input
                        type="text"
                        list="order-price-product-list"
                        value={filters.product}
                        onChange={(e) => update('product', e.target.value)}
                        placeholder="e.g. Ladies Finger"
                    />
                </label>
                <button type="submit" disabled={loading}>{loading ? 'Loading…' : 'Show'}</button>
            </form>

            {status && <p className="price-status">{status}</p>}

            {rows.length > 0 && (
                <>
                    <h2 className="price-product-title">{filters.product}</h2>
                    <div className="price-table-wrapper">
                        <table className="price-table">
                            <thead>
                                <tr><th>Bill No.</th><th>Party</th><th>Item Price</th><th>Item Quantity</th></tr>
                            </thead>
                            <tbody>
                                {rows.map((row, index) => (
                                    <tr key={`${row.orderId}-${row.itemId}`}>
                                        <td>{row.billNo}</td>
                                        <td className="price-customer">{row.customerName}</td>
                                        <td>
                                            <input
                                                type="number"
                                                step="0.01"
                                                value={row.price}
                                                data-price-column="price"
                                                onKeyDown={handlePriceRowEnter}
                                                onChange={(e) => editRow(index, 'price', e.target.value)}
                                                onBlur={() => saveRow(index)}
                                            />
                                        </td>
                                        <td>
                                            <input
                                                type="number"
                                                value={row.quantity}
                                                data-price-column="quantity"
                                                onKeyDown={handlePriceRowEnter}
                                                onChange={(e) => editRow(index, 'quantity', e.target.value)}
                                                onBlur={() => saveRow(index)}
                                            />
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </>
            )}
        </section>
    );
};

// --- Bottom section: no product picked -> every product ordered in the date range,
// one row each. Editing its price applies to every order bill in range that has it.
const BulkPriceSection = () => {
    const [filters, setFilters] = useState(emptyBulkFilters);
    const [productRows, setProductRows] = useState([]); // { name, price, orders }
    const [loading, setLoading] = useState(false);
    const [status, setStatus] = useState('Pick a date range to list every product ordered in it.');

    const update = (key, value) => setFilters((current) => ({ ...current, [key]: value }));

    const loadProductRows = useCallback(async (activeFilters) => {
        setLoading(true);
        setStatus('');
        const params = new URLSearchParams();
        if (activeFilters.startDate) params.set('startDate', activeFilters.startDate);
        if (activeFilters.endDate) params.set('endDate', activeFilters.endDate);
        try {
            const orders = await fetchJson(`/api/orders?${params.toString()}`);
            const byName = new Map();
            // Orders come back newest-first, so the first line seen for a product is its most recent price.
            orders.forEach((order) => {
                (order.products || []).forEach((item) => {
                    const key = (item.name || '').trim().toLowerCase();
                    if (!key) return;
                    if (!byName.has(key)) {
                        byName.set(key, { name: item.name, price: item.single_price ?? '', orders: [] });
                    }
                    byName.get(key).orders.push(order);
                });
            });
            const built = Array.from(byName.values()).sort((a, b) => a.name.localeCompare(b.name));
            setProductRows(built);
            setStatus(built.length ? '' : 'No products found in the selected date range.');
        } catch (error) {
            setProductRows([]);
            setStatus(error.message);
        } finally {
            setLoading(false);
        }
    }, []);

    const submitFilter = (event) => { event.preventDefault(); loadProductRows(filters); };

    const editProductRow = (index, value) => {
        setProductRows((current) => current.map((row, i) => (i === index ? { ...row, price: value } : row)));
    };

    // Persist one product row's price into every order bill in range that has that product.
    const saveProductRow = async (index) => {
        const row = productRows[index];
        if (!row) return;
        const priceNum = Number(row.price) || 0;
        const term = row.name.trim().toLowerCase();
        try {
            const updatedOrders = await Promise.all(row.orders.map((order) => {
                const updatedProducts = (order.products || []).map((p) => (
                    (p.name || '').trim().toLowerCase() === term ? { ...p, single_price: priceNum } : p
                ));
                return fetchJson(`/api/orders/${order._id}`, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ customer: order.customer, bill_details: order.bill_details, products: updatedProducts }),
                });
            }));
            setProductRows((current) => current.map((r, i) => (
                i === index ? { ...r, price: priceNum, orders: updatedOrders } : r
            )));
            setStatus(`Updated "${row.name}" to ₹${priceNum.toFixed(2)} in ${row.orders.length} bill(s).`);
        } catch (error) {
            setStatus(error.message);
        }
    };

    return (
        <section className="price-card">
            <header className="price-header">
                <p className="price-eyebrow">Bulk price</p>
                <h1>Update price across every order bill</h1>
                <p>List every product ordered in the date range, one price per product — editing it updates that price in every order bill in range that has it.</p>
            </header>

            <form className="price-filters" onSubmit={submitFilter}>
                <label><span>Start date</span>
                    <input type="date" value={filters.startDate} max={filters.endDate || undefined} onChange={(e) => update('startDate', e.target.value)} />
                </label>
                <label><span>End date</span>
                    <input type="date" value={filters.endDate} min={filters.startDate || undefined} onChange={(e) => update('endDate', e.target.value)} />
                </label>
                <button type="submit" disabled={loading}>{loading ? 'Loading…' : 'Show'}</button>
            </form>

            {status && <p className="price-status">{status}</p>}

            {productRows.length > 0 && (
                <div className="price-table-wrapper">
                    <table className="price-table">
                        <thead>
                            <tr><th>Product Name</th><th>Price</th><th>Bills</th></tr>
                        </thead>
                        <tbody>
                            {productRows.map((row, index) => (
                                <tr key={row.name}>
                                    <td className="price-customer">{row.name}</td>
                                    <td>
                                        <input
                                            type="number"
                                            step="0.01"
                                            value={row.price}
                                            data-price-column="price"
                                            onKeyDown={handlePriceRowEnter}
                                            onChange={(e) => editProductRow(index, e.target.value)}
                                            onBlur={() => saveProductRow(index)}
                                        />
                                    </td>
                                    <td>{row.orders.length}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}
        </section>
    );
};

const OrderPrice = () => {
    const [productNames, setProductNames] = useState([]); // only products that actually appear inside an order bill

    useEffect(() => {
        fetchJson('/api/orders/product-names').then(setProductNames).catch(() => {});
    }, []);

    return (
        <main className="price-page">
            <div className="price-stack">
                <ByBillSection />
                <BulkPriceSection />
            </div>
            <datalist id="order-price-product-list">
                {productNames.map((name) => <option key={name} value={name} />)}
            </datalist>
        </main>
    );
};

export default OrderPrice;
