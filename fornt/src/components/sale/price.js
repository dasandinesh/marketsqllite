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

// --- Top section: pick a product -> one row per bill/customer that has it, with
// Price and Quantity editable inline (save-on-blur, same as the rest of the app).
const ByBillSection = () => {
    const [filters, setFilters] = useState(emptyByBillFilters);
    const [rows, setRows] = useState([]); // { saleId, itemId, billNo, customerName, price, quantity, sale }
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
            const sales = await fetchJson(`/api/sales?${params.toString()}`);
            const term = productName.toLowerCase();
            const built = sales
                .map((sale) => {
                    const item = (sale.products || []).find((p) => (p.name || '').toLowerCase() === term);
                    if (!item) return null;
                    return {
                        saleId: sale._id,
                        itemId: item._id,
                        billNo: sale.bill_details?.order_sno || '—',
                        customerName: sale.customer?.name || '—',
                        price: item.single_price ?? '',
                        quantity: item.quantity ?? '',
                        sale,
                    };
                })
                .filter(Boolean);
            setRows(built);
            setStatus(built.length ? '' : 'No bills have this product in the selected date range.');
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

    // Persist one row's edited price/quantity into its bill, reusing the normal sale
    // update endpoint — the backend recomputes the line amount and bill totals itself.
    const saveRow = async (index) => {
        const row = rows[index];
        if (!row) return;
        const updatedProducts = (row.sale.products || []).map((p) => (
            p._id === row.itemId
                ? { ...p, single_price: Number(row.price) || 0, quantity: Number(row.quantity) || 0 }
                : p
        ));
        const payload = {
            customer: row.sale.customer,
            bill_details: row.sale.bill_details,
            products: updatedProducts,
        };
        try {
            const updated = await fetchJson(`/api/sales/${row.saleId}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
            });
            const item = (updated.products || []).find((p) => p._id === row.itemId) || {};
            setRows((current) => current.map((r, i) => (
                i === index ? { ...r, sale: updated, price: item.single_price ?? r.price, quantity: item.quantity ?? r.quantity } : r
            )));
            setStatus(`Saved — bill ${row.billNo} (${row.customerName}) updated.`);
        } catch (error) {
            setStatus(error.message);
        }
    };

    return (
        <section className="price-card">
            <header className="price-header">
                <h3>Update price / quantity per bill</h3>
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
                        list="price-product-list"
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
                                <tr><th>Bill No.</th><th>Customer</th><th>Item Price</th><th>Item Quantity</th></tr>
                            </thead>
                            <tbody>
                                {rows.map((row, index) => (
                                    <tr key={`${row.saleId}-${row.itemId}`}>
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

// --- Bottom section: no product picked -> every product sold in the date range,
// one row each. Editing its price applies to every bill in range that has it.
const BulkPriceSection = () => {
    const [filters, setFilters] = useState(emptyBulkFilters);
    const [productRows, setProductRows] = useState([]); // { name, price, sales }
    const [loading, setLoading] = useState(false);
    const [status, setStatus] = useState('Pick a date range to list every product sold in it.');

    const update = (key, value) => setFilters((current) => ({ ...current, [key]: value }));

    const loadProductRows = useCallback(async (activeFilters) => {
        setLoading(true);
        setStatus('');
        const params = new URLSearchParams();
        if (activeFilters.startDate) params.set('startDate', activeFilters.startDate);
        if (activeFilters.endDate) params.set('endDate', activeFilters.endDate);
        try {
            const sales = await fetchJson(`/api/sales?${params.toString()}`);
            const byName = new Map();
            // Sales come back newest-first, so the first line seen for a product is its most recent price.
            sales.forEach((sale) => {
                (sale.products || []).forEach((item) => {
                    const key = (item.name || '').trim().toLowerCase();
                    if (!key) return;
                    if (!byName.has(key)) {
                        byName.set(key, { name: item.name, price: item.single_price ?? '', sales: [] });
                    }
                    byName.get(key).sales.push(sale);
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

    // Persist one product row's price into every bill in range that has that product.
    const saveProductRow = async (index) => {
        const row = productRows[index];
        if (!row) return;
        const priceNum = Number(row.price) || 0;
        const term = row.name.trim().toLowerCase();
        try {
            const updatedSales = await Promise.all(row.sales.map((sale) => {
                const updatedProducts = (sale.products || []).map((p) => (
                    (p.name || '').trim().toLowerCase() === term ? { ...p, single_price: priceNum } : p
                ));
                return fetchJson(`/api/sales/${sale._id}`, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ customer: sale.customer, bill_details: sale.bill_details, products: updatedProducts }),
                });
            }));
            setProductRows((current) => current.map((r, i) => (
                i === index ? { ...r, price: priceNum, sales: updatedSales } : r
            )));
            setStatus(`Updated "${row.name}" to ₹${priceNum.toFixed(2)} in ${row.sales.length} bill(s).`);
        } catch (error) {
            setStatus(error.message);
        }
    };

    return (
        <section className="price-card">
            <header className="price-header">
                <h3>Update price across every bill</h3>
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
                                    <td>{row.sales.length}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}
        </section>
    );
};

const Price = () => {
    const [productNames, setProductNames] = useState([]); // only products that actually appear inside a sale bill

    useEffect(() => {
        fetchJson('/api/sales/product-names').then(setProductNames).catch(() => {});
    }, []);

    return (
        <main className="price-page">
            <div className="price-stack">
                <ByBillSection />
                <BulkPriceSection />
            </div>
            <datalist id="price-product-list">
                {productNames.map((name) => <option key={name} value={name} />)}
            </datalist>
        </main>
    );
};

export default Price;
