import React, { useRef, useState, useEffect, useCallback } from 'react';
import { useForm, useFieldArray } from "react-hook-form";
import './sale.css';
import axios from 'axios';
import { renderBillHtml, buildBillsDocumentHtml } from './billTemplate';

// Local calendar date as yyyy-mm-dd (toISOString alone would shift the day for non-UTC zones).
const todayString = () => {
    const now = new Date();
    now.setMinutes(now.getMinutes() - now.getTimezoneOffset());
    return now.toISOString().split("T")[0];
};

function CurrentDate() {
  const [date, setDate] = useState(new Date());

  useEffect(() => {
    const timer = setInterval(() => setDate(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  return <p>{date.toLocaleString()}</p>;
}

// Any stored/ISO date -> yyyy-mm-dd for a <input type="date">.
const toDateInput = (value) => {
    if (!value) return todayString();
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return todayString();
    parsed.setMinutes(parsed.getMinutes() - parsed.getTimezoneOffset());
    return parsed.toISOString().split("T")[0];
};

const SaleEntry = () => {
    const CustomerNameInputRef = useRef(null);
    const productNameInputRef = useRef(null);
    const quantityInputRef = useRef(null);
    const bagsInputRef = useRef(null);
    const scaleInputRef = useRef(null);
    const singlePriceInputRef = useRef(null);
    const bagRateInputRef = useRef(null);
    const wageInputRef = useRef(null);
    const commissionInputRef = useRef(null);
    const saleSummaryContentRef = useRef(null);

    const [customerList, setCustomerList] = useState([]);
    const [productList, setProductList] = useState([]);
    const [invoiceSetting, setInvoiceSetting] = useState(null); // shop letterhead printed on bills.

    // Summary panel: defaults to today's sales, refetches whenever a date changes.
    const [saleFilter, setSaleFilter] = useState({ startDate: todayString(), endDate: todayString() });
    const [saleSummary, setSaleSummary] = useState([]);
    const [summaryStatus, setSummaryStatus] = useState('');
    const [selectedIds, setSelectedIds] = useState(new Set()); // sale _ids checked in the summary list.

    // Order (purchase) bill list — a separate panel, same shape as the sale list above, own filter/selection.
    const [orderFilter, setOrderFilter] = useState({ startDate: todayString(), endDate: todayString() });
    const [orderListSummary, setOrderListSummary] = useState([]);
    const [orderListStatus, setOrderListStatus] = useState('');
    const [orderSelectedIds, setOrderSelectedIds] = useState(new Set());
    const [orderSelectedRow, setOrderSelectedRow] = useState(-1);

    const loadSaleSummary = useCallback(async () => {
        const params = new URLSearchParams();
        if (saleFilter.startDate) params.set('startDate', saleFilter.startDate);
        if (saleFilter.endDate) params.set('endDate', saleFilter.endDate);
        setSummaryStatus('Loading…');
        setSelectedRow(-1);
        setSelectedIds(new Set());
        try {
            const response = await axios.get(`/api/sales${params.toString() ? `?${params}` : ''}`);
            setSaleSummary(response.data);
            setSummaryStatus(response.data.length ? '' : 'No sales for this date.');
        } catch (error) {
            setSaleSummary([]);
            setSummaryStatus(error.response?.data?.error || 'Unable to load sales.');
        }
    }, [saleFilter.startDate, saleFilter.endDate]);

    const loadOrderListSummary = useCallback(async () => {
        const params = new URLSearchParams();
        if (orderFilter.startDate) params.set('startDate', orderFilter.startDate);
        if (orderFilter.endDate) params.set('endDate', orderFilter.endDate);
        setOrderListStatus('Loading…');
        setOrderSelectedRow(-1);
        setOrderSelectedIds(new Set());
        try {
            const response = await axios.get(`/api/orders${params.toString() ? `?${params}` : ''}`);
            setOrderListSummary(response.data);
            setOrderListStatus(response.data.length ? '' : 'No orders for this date.');
        } catch (error) {
            setOrderListSummary([]);
            setOrderListStatus(error.response?.data?.error || 'Unable to load orders.');
        }
    }, [orderFilter.startDate, orderFilter.endDate]);

    useEffect(() => {
        loadSaleSummary();
    }, [loadSaleSummary]);

    useEffect(() => {
        loadOrderListSummary();
    }, [loadOrderListSummary]);

    useEffect(() => {
        axios.get('/api/customers')
            .then(response => {
                setCustomerList(response.data);
            })
            .catch(error => {
                console.error('Error fetching customer list:', error);
            });

        axios.get('/api/products')
            .then(response => {
                setProductList(response.data);
            })
            .catch(error => {
                console.error('Error fetching product list:', error);
            });

        axios.get('/api/invoice-settings/active')
            .then(response => setInvoiceSetting(response.data))
            .catch(() => setInvoiceSetting(null)); // 0 or >1 settings — bill prints without a letterhead.

        CustomerNameInputRef.current?.focus();
    }, []);

    const handleKeyDown = (e, currentRef, nextRef) => {
        if (e.key === 'Enter') {
            e.preventDefault(); // Prevents accidental form submission
            nextRef.current?.focus();
            if (currentRef === commissionInputRef) {
                if (!product.name || !product.quantity || !product.scale || !product.single_price) {
                    alert("Please fill in product name, quantity, scale and single price before adding (bags is optional).");
                    return;
                } else {
                    handleAddProduct();
                    alert("Product Added");
                }
                setTimeout(() => {
                    productNameInputRef.current?.focus();
                }, 0);
            }
        }
    };

    // Function to move focus to the next index on Enter
    const handleKeyDownforprice = (e, fieldName, index) => {
        if (e.key === 'Enter') {
            e.preventDefault(); // Prevent form submission on Enter
            const nextInput = document.querySelector(`input[name="products.${index + 1}.${fieldName}"]`);
            if (nextInput) {
                nextInput.focus();
                nextInput.select(); // Optional: selects text for quick editing
            }
        }
    };
    const [isSubscribed, setIsSubscribed] = useState(false);
    const handleCheckboxChange = () => {
        setIsSubscribed(!isSubscribed);
    };

    const emptyProduct = {
        name: "",
        comment: "",
        tamil: "",
        quantity: "",
        bags: "",
        scale: "mixters",
        single_price: "",
        bagRate: "",
        wage: "",
        commission: "",
    };

    const [product, setProduct] = useState(emptyProduct);

    const [saveStatus, setSaveStatus] = useState('');
    const [lastSavedBill, setLastSavedBill] = useState(null);
    const [editingId, setEditingId] = useState(null); // null = creating a new sale.
    const [viewSale, setViewSale] = useState(null); // sale shown in the read-only details popup.
    const [viewOrderBill, setViewOrderBill] = useState(null); // order shown in the read-only details popup.
    const [selectedRow, setSelectedRow] = useState(-1); // highlighted row in the summary list.

    useEffect(() => {
        const list = saleSummaryContentRef.current;
        const row = list?.querySelector('.sale-row-selected');
        if (!row) return;

        // Scroll only this list, keeping the selected row fully visible.
        const listBounds = list.getBoundingClientRect();
        const rowBounds = row.getBoundingClientRect();
        const visibleTop = listBounds.top + list.clientTop;
        const visibleBottom = visibleTop + list.clientHeight;
        if (rowBounds.bottom > visibleBottom) {
            list.scrollTop += rowBounds.bottom - visibleBottom;
        } else if (rowBounds.top < visibleTop) {
            list.scrollTop += rowBounds.top - visibleTop;
        }
    }, [selectedRow, saleSummary]);
    const [customerWarning, setCustomerWarning] = useState(''); // set when a name is not in the customer list.
    const [productWarning, setProductWarning] = useState(''); // set when a name is not in the product list.

    const customerExists = (name) =>
        !name || customerList.some((cust) => cust.name?.toLowerCase() === name.trim().toLowerCase());
    const productExists = (name) =>
        !name || productList.some((prod) => prod.name?.toLowerCase() === name.trim().toLowerCase());
    const { register, control, handleSubmit, setValue, reset, getValues, watch } = useForm({
        defaultValues: {
            customer: { name: "" },
            bill_details: {
                order_sno: "",
                order_no: "",
                mainParty: "",
                date: new Date().toISOString().split("T")[0],
                bill_date: new Date().toISOString().split("T")[0],
                total_quantity: "",
                bag_quantity: "",
                weight: "",
                subtotal: "",
                bagAmountTotal: "",
                wageTotal: "",
                commissionTotal: "",
                freight: "",
                bill_amount: "",
                balance: "",
                old_balance: "",
                net_balance: "",
                debit: "",
                credit: "",
                remark: "",
                billed: false,
            },
            products: [],
        },
    });
    const customerNameRegistration = register("customer.name", { required: "Customer name is required." });
    const { fields, append, remove } = useFieldArray({
        control,
        name: "products",
    });

    // Line amount is always Quantity × Single Price. Bags never drive the price.
    const lineAmount = (item) => Number(item.quantity || 0) * Number(item.single_price || 0);

    const handleAddProduct = () => {
        if (!productExists(product.name)) {
            setProductWarning('This product is not in the list. Please add the product first.');
            return;
        }
        if (!product.quantity) {
            alert('Quantity is required.');
            return;
        }
        append({
            ...product,
            base_price: lineAmount(product),
        });
        setProduct(emptyProduct);
        calculateTotals();
    };

    const calculateTotals = useCallback(() => {
        const products = getValues("products");
        const totalQuantity = products.reduce((sum, p) => sum + Number(p.quantity || 0), 0);
        const totalBagQuantity = products.reduce((sum, p) => sum + Number(p.bags || 0), 0);
        const totalWeight = products.reduce((sum, p) => sum + (Number(p.quantity || 0) * Number(p.scale || 0)), 0);
        const subtotal = products.reduce((sum, p) => sum + lineAmount(p), 0);
        // Bag price / wage / commission only apply when a bag count is entered on the line.
        const bagCharge = (p, rateField) => (Number(p.bags || 0) > 0 ? Number(p.bags) * Number(p[rateField] || 0) : 0);
        const bagAmountTotal = products.reduce((sum, p) => sum + bagCharge(p, 'bagRate'), 0);
        const wageTotal = products.reduce((sum, p) => sum + bagCharge(p, 'wage'), 0);
        const commissionTotal = products.reduce((sum, p) => sum + bagCharge(p, 'commission'), 0);
        const freight = Number(getValues('bill_details.freight') || 0);
        setValue('bill_details.total_quantity', totalQuantity);
        setValue('bill_details.bag_quantity', totalBagQuantity);
        setValue('bill_details.weight', totalWeight);
        setValue('bill_details.subtotal', subtotal);
        setValue('bill_details.bagAmountTotal', bagAmountTotal);
        setValue('bill_details.wageTotal', wageTotal);
        setValue('bill_details.commissionTotal', commissionTotal);
        setValue('bill_details.bill_amount', subtotal + bagAmountTotal + wageTotal + commissionTotal + freight);
    }, [getValues, setValue]);

    // Recalculate every total whenever ANY field of ANY product row changes — typing in a
    // cell, adding/removing a row, or reordering — without wiring onChange on each input.
    const watchedProducts = watch('products');
    useEffect(() => {
        calculateTotals();
    }, [watchedProducts, calculateTotals]);

    // When Quantity or Bags in a table row loses focus, recompute that row's Price
    // (Quantity × Single Price) so it reflects the new value straight away.
    const syncLineAmount = (index) => {
        const row = getValues(`products.${index}`);
        setValue(`products.${index}.base_price`, lineAmount(row));
    };
    const up = (index) => {
        if (index > 0) {
            const values = getValues("products");
            [values[index], values[index - 1]] = [values[index - 1], values[index]];
            reset({ ...getValues(), products: values });
            calculateTotals();
        }
    };
    const blankForm = () => ({
        customer: { name: "" },
        bill_details: {
            order_sno: "",
            order_no: "",
            mainParty: "",
            date: todayString(),
            bill_date: todayString(),
            total_quantity: "",
            bag_quantity: "",
            weight: "",
            subtotal: "",
            bagAmountTotal: "",
            wageTotal: "",
            commissionTotal: "",
            freight: "",
            bill_amount: "",
            balance: "",
            old_balance: "",
            net_balance: "",
            debit: "",
            credit: "",
            remark: "",
            billed: false,
        },
        products: [],
    });

    const handleNewSale = () => {
        setEditingId(null);
        setIsSubscribed(false);
        setSaveStatus('');
        setSelectedRow(-1);
        setCustomerWarning('');
        setProductWarning('');
        reset(blankForm());
    };

    // Load an existing sale from the summary list back into the form for editing.
    const handleEdit = (sale, scrollToForm = true) => {
        setEditingId(sale._id);
        setIsSubscribed(Boolean(sale.bill_details?.billed));
        setSaveStatus('');
        setCustomerWarning('');
        setProductWarning('');
        reset({
            customer: { name: sale.customer?.name || "" },
            bill_details: {
                ...blankForm().bill_details,
                ...sale.bill_details,
                date: toDateInput(sale.bill_details?.date),
                bill_date: toDateInput(sale.bill_details?.bill_date),
            },
            products: (sale.products || []).map((item) => ({
                name: item.name || "",
                comment: item.comment || "",
                tamil: item.tamil || "",
                quantity: item.quantity ?? "",
                bags: item.bags ?? "",
                scale: item.scale || "",
                single_price: item.single_price ?? "",
                base_price: item.base_price ?? "",
                bagRate: item.bagRate ?? "",
                wage: item.wage ?? "",
                commission: item.commission ?? "",
            })),
        });
        if (scrollToForm) window.scrollTo({ top: 0, behavior: 'smooth' });
    };

    // Turn an order (purchase) bill into a fresh sale — pulls the customer and product
    // lines across, re-pricing each line from the product master (sale price/wage/commission)
    // rather than reusing the order's purchase price.
    const handleUseOrderForSale = (order) => {
        setEditingId(null); // always a new sale, never overwrites an existing one.
        setIsSubscribed(false);
        setSaveStatus('');
        setSelectedRow(-1);
        setCustomerWarning('');
        setProductWarning('');
        reset({
            customer: { name: order.customer?.name || "" },
            bill_details: { ...blankForm().bill_details },
            products: (order.products || []).map((item) => {
                const prod = productList.find((p) => p.name?.toLowerCase() === (item.name || '').trim().toLowerCase());
                const mapped = {
                    name: item.name || "",
                    comment: item.comment || "",
                    tamil: prod?.Tamil || prod?.tamil || "",
                    quantity: item.quantity ?? "",
                    bags: item.bags ?? "",
                    scale: item.scale || prod?.Unit || "",
                    single_price: prod ? prod.Price : (item.single_price ?? ""),
                    bagRate: prod ? (prod.pags ?? "") : "",
                    wage: prod ? (prod.Wages ?? "") : "",
                    commission: prod ? (prod.commission ?? "") : "",
                };
                return { ...mapped, base_price: lineAmount(mapped) };
            }),
        });
        calculateTotals();
        setSaveStatus(`Sale entry filled from order ${order.bill_details?.order_sno || ''}. Review and save.`);
        window.scrollTo({ top: 0, behavior: 'smooth' });
    };

    // Arrow up/down through the summary list; the highlighted sale is loaded into the form.
    const handleSummaryKeyDown = (e) => {
        if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
        if (!saleSummary.length) return;
        e.preventDefault();
        setSelectedRow((current) => {
            const base = current < 0 ? (e.key === 'ArrowDown' ? -1 : saleSummary.length) : current;
            const next = e.key === 'ArrowDown'
                ? Math.min(base + 1, saleSummary.length - 1)
                : Math.max(base - 1, 0);
            handleEdit(saleSummary[next], false);
            return next;
        });
    };

    // After a customer is picked, if the selected date range already has a sale for
    // that customer, pull it into the form so it can be updated instead of duplicated.
    const loadExistingSaleForCustomer = (name) => {
        if (!name || editingId) return;
        const match = saleSummary.find(
            (sale) => sale.customer?.name?.toLowerCase() === name.trim().toLowerCase()
        );
        if (match) {
            const rowIndex = saleSummary.indexOf(match);
            setSelectedRow(rowIndex);
            handleEdit(match);
            setSaveStatus(`Existing sale ${match.bill_details?.order_sno || ''} loaded for editing.`);
        }
    };

    const toggleSelectAll = (e) => {
        setSelectedIds(e.target.checked ? new Set(saleSummary.map((sale) => sale._id)) : new Set());
    };

    const toggleSelectRow = (id) => {
        setSelectedIds((prev) => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id); else next.add(id);
            return next;
          });
    };

    const handleDeleteSelected = async () => {
        if (!selectedIds.size) {
            alert('Select at least one sale to delete.');
            return;
        }
        if (!window.confirm(`Delete ${selectedIds.size} selected sale(s)? This cannot be undone.`)) return;
        try {
            await Promise.all(Array.from(selectedIds).map((id) => axios.delete(`/api/sales/${id}`)));
            if (editingId && selectedIds.has(editingId)) handleNewSale();
            setSelectedIds(new Set());
            loadSaleSummary();
        } catch (error) {
            setSummaryStatus(error.response?.data?.error || 'Unable to delete selected sales.');
        }
    };

    // Order list panel — same select-all/select-row/delete pattern as the sale list above.
    const toggleOrderSelectAll = (e) => {
        setOrderSelectedIds(e.target.checked ? new Set(orderListSummary.map((order) => order._id)) : new Set());
    };

    const toggleOrderSelectRow = (id) => {
        setOrderSelectedIds((prev) => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id); else next.add(id);
            return next;
        });
    };

    const handleOrderSummaryKeyDown = (e) => {
        if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
        if (!orderListSummary.length) return;
        e.preventDefault();
        setOrderSelectedRow((current) => {
            const base = current < 0 ? (e.key === 'ArrowDown' ? -1 : orderListSummary.length) : current;
            return e.key === 'ArrowDown'
                ? Math.min(base + 1, orderListSummary.length - 1)
                : Math.max(base - 1, 0);
        });
    };

    const handleDeleteSelectedOrders = async () => {
        if (!orderSelectedIds.size) {
            alert('Select at least one order to delete.');
            return;
        }
        if (!window.confirm(`Delete ${orderSelectedIds.size} selected order(s)? This cannot be undone.`)) return;
        try {
            await Promise.all(Array.from(orderSelectedIds).map((id) => axios.delete(`/api/orders/${id}`)));
            setOrderSelectedIds(new Set());
            loadOrderListSummary();
        } catch (error) {
            setOrderListStatus(error.response?.data?.error || 'Unable to delete selected orders.');
        }
    };

    // Groups the currently loaded sales by customer and prints one line per
    // customer listing each "mixters"-scale product with its quantity and scale, A5 page size.
    const handlePrintByCustomer = () => {
        if (!saleSummary.length) {
            alert('No sales to print for the selected dates.');
            return;
        }
        const grouped = new Map();
        saleSummary.forEach((sale) => {
            const name = sale.customer?.name || 'Unknown';
            const mixerProducts = (sale.products || []).filter((item) => item.scale === 'mixters');
            if (!mixerProducts.length) return;
            if (!grouped.has(name)) grouped.set(name, []);
            grouped.get(name).push(...mixerProducts);
        });

        if (!grouped.size) {
            alert('No "mixters" scale products in the selected sales.');
            return;
        }

        const rows = Array.from(grouped.entries()).map(([customer, products]) => {
            const productText = products
                .map((item) => `${item.name} ${item.quantity}${item.scale || ''}`)
                .join(', ');
            return `<div class="customer-block"><span class="customer-name">${customer}</span> — ${productText}</div>`;
        }).join('');

        const printWindow = window.open('', '_blank', 'width=600,height=800');
        if (!printWindow) {
            alert('Please allow popups to print.');
            return;
        }
        printWindow.document.write(`
            <html>
            <head>
                <title>Sale Summary</title>
                <style>
                    @page { size: A5; margin: 10mm; }
                    body { font-family: Arial, sans-serif; font-size: 13px; }
                    h3 { margin: 0 0 10px; }
                    .customer-block { margin-bottom: 6px; }
                    .customer-name { font-weight: bold; }
                </style>
            </head>
            <body>
                <h3>Sales (${saleFilter.startDate} to ${saleFilter.endDate})</h3>
                ${rows}
            </body>
            </html>
        `);
        printWindow.document.close();
        printWindow.focus();
        printWindow.print();
    };

    // Open a print window with one bill per A5 page. The actual bill markup/styles
    // live in ./billTemplate.js — edit that file to change how a bill looks.
    const openBillsWindow = (records) => {
        const bills = records
            .map((record) => {
                const customer = customerList.find(
                    (c) => c.name?.toLowerCase() === (record.customer?.name || '').trim().toLowerCase()
                );
                return renderBillHtml(record, invoiceSetting || {}, customer);
            })
            .filter(Boolean);
        if (!bills.length) {
            alert('Nothing to print — the selected bill(s) have no products.');
            return;
        }
        const win = window.open('', '_blank', 'width=640,height=900');
        if (!win) {
            alert('Please allow popups to print the bill.');
            return;
        }
        win.document.write(buildBillsDocumentHtml(bills, `Bills (${bills.length})`));
        win.document.close();
        win.focus();
    };

    const handlePrintBill = (record) => openBillsWindow([record]);

    // Print the checked rows, or every row in the list if none are checked.
    const handlePrintSales = (all = false) => {
        const chosen = all || !selectedIds.size
            ? saleSummary
            : saleSummary.filter((s) => selectedIds.has(s._id));
        if (!chosen.length) { alert('No sales to print.'); return; }
        openBillsWindow(chosen);
    };

    const handlePrintOrders = (all = false) => {
        const chosen = all || !orderSelectedIds.size
            ? orderListSummary
            : orderListSummary.filter((o) => orderSelectedIds.has(o._id));
        if (!chosen.length) { alert('No orders to print.'); return; }
        openBillsWindow(chosen);
    };

    const onSubmit = async (data) => {
        setSaveStatus('');
        if (!customerExists(data.customer?.name)) {
            setCustomerWarning('This customer is not in the list. Please add the customer first.');
            return;
        }
        const unknownProduct = (data.products || []).find((item) => item.name && !productExists(item.name));
        if (unknownProduct) {
            setSaveStatus(`Product "${unknownProduct.name}" is not in the list. Please add it first.`);
            return;
        }
        const payload = {
            ...data,
            bill_details: { ...data.bill_details, billed: isSubscribed },
        };
        try {
            const response = editingId
                ? await axios.put(`/api/sales/${editingId}`, payload)
                : await axios.post('/api/sales', payload);
            const sno = response.data.bill_details?.order_sno || '';
            setLastSavedBill(response.data);
            setSaveStatus(`Sale ${sno} ${editingId ? 'updated' : 'saved'} successfully.`);
            setEditingId(null);
            setIsSubscribed(false);
            reset(blankForm());
            loadSaleSummary();
        } catch (error) {
            setSaveStatus(error.response?.data?.error || 'Unable to save sale.');
        }
    };

    return (
        <div className="sale-entry-container">
            <div className="sale-entry-form">
                <form onSubmit={handleSubmit(onSubmit)}>
                    <div className="sale-customer-bill-details">
                        <div className="sale-customer-name-field"><label>Customer Name:</label>
                            <input
                                type="text"
                                className="sale-textInput"
                                {...customerNameRegistration}
                                list="customer-list"
                                ref={(element) => {
                                    customerNameRegistration.ref(element);
                                    CustomerNameInputRef.current = element;
                                }}
                                onChange={(e) => {
                                    customerNameRegistration.onChange(e);
                                    if (customerWarning) setCustomerWarning('');
                                }}
                                onBlur={(e) => {
                                    customerNameRegistration.onBlur(e);
                                    const known = customerExists(e.target.value);
                                    setCustomerWarning(known ? '' : 'This customer is not in the list. Please add the customer first.');
                                    if (known) loadExistingSaleForCustomer(e.target.value);
                                }}
                                onKeyDown={(e) => handleKeyDown(e, CustomerNameInputRef, productNameInputRef)}
                            />
                            {customerWarning && <p className="sale-field-warning" role="alert">{customerWarning}</p>}</div>
                        <datalist id="customer-list">
                            {customerList.map((cust, index) => (
                                <option key={index} value={cust.name} />
                            ))}
                        </datalist>
                    
                        <div><label>Bill Date:</label><br></br>
                            <input type="date" {...register("bill_details.date")} /></div>

                        <div> <label>Bill Number:</label>
                            <input type="text" placeholder="Auto" {...register("bill_details.order_sno")} /></div>
                    </div>
                    <div>
                        <div className="sale-product-input-grid">
                            <div className="sale-product-input-field">
                                <label>Product Name</label>
                                <br />
                                <input
                                    type="text"
                                    name="productname"
                                    value={product.name}
                                    placeholder="Product Name"
                                    list="product-list"
                                    ref={productNameInputRef}
                                    className="sale-textInput"
                                    onChange={(e) => {
                                        const val = e.target.value;
                                        const selectedProduct = productList.find((prod) => prod.name === val);
                                        if (productWarning) setProductWarning('');
                                        setProduct({
                                            ...product,
                                            name: val,
                                            tamil: selectedProduct?.tamil || selectedProduct?.Tamil || "",
                                            single_price: selectedProduct ? selectedProduct.Price : "",
                                            bagRate: selectedProduct ? (selectedProduct.pags ?? "") : "",
                                            wage: selectedProduct ? (selectedProduct.Wages ?? "") : "",
                                            commission: selectedProduct ? (selectedProduct.commission ?? "") : "",
                                        });
                                    }}
                                    onBlur={(e) => setProductWarning(productExists(e.target.value) ? '' : 'This product is not in the list. Please add the product first.')}
                                    onKeyDown={(e) => handleKeyDown(e, productNameInputRef, quantityInputRef)}
                                />

                                <datalist id="product-list">
                                    {productList.map((prod, index) => (
                                        <option key={index} value={prod.name} />
                                    ))}
                                </datalist>
                                {productWarning && <p className="sale-field-warning" role="alert">{productWarning}</p>}
                            </div>
                            <div className="sale-product-input-field">
                                <label>Quantity</label>
                                <br />
                                <input
                                    type="number"
                                    name="quantity"
                                    id="quantity"
                                    ref={quantityInputRef}
                                    value={product.quantity}
                                    className="sale-small-input"
                                    onChange={(e) => {
                                        setProduct({ ...product, quantity: e.target.value });
                                    }}
                                    placeholder="Quantity"
                                    onKeyDown={(e) => handleKeyDown(e, quantityInputRef, bagsInputRef)}
                                />
                            </div>
                            <div className="sale-product-input-field">
                                <label>bags</label>
                                <br />
                                <input
                                    type="number"
                                    name="bags"
                                    id="bags"
                                    ref={bagsInputRef}
                                    value={product.bags}
                                    className="sale-small-input"
                                    onChange={(e) => {
                                        const bags = e.target.value;
                                        // Entering a bag count auto-fills Scale with the product's unit.
                                        const selectedProduct = productList.find((prod) => prod.name === product.name);
                                        setProduct({
                                            ...product,
                                            bags,
                                            scale: bags && selectedProduct?.Unit ? selectedProduct.Unit : product.scale,
                                        });
                                    }}
                                    placeholder="Bags"
                                    onKeyDown={(e) => handleKeyDown(e, bagsInputRef, scaleInputRef)}
                                />
                            </div>
                            <div className="sale-product-input-field">
                                <label>Scale</label>
                                <br />
                                <input
                                    type="text"
                                    name="scale"
                                    value={product.scale}
                                    className="sale-small-input"
                                    onChange={(e) => setProduct({ ...product, scale: e.target.value })}
                                    placeholder="Scale"
                                    ref={scaleInputRef}
                                    onKeyDown={(e) => handleKeyDown(e, scaleInputRef, singlePriceInputRef)}
                                    list='scallist'
                                />
                                <datalist id="scallist">
                                    <option value="mixters" />
                                    <option value="bag" />
                                    <option value="o bag" />
                                    <option value="leaves" />
                                    <option value="box" />
                                </datalist>
                            </div>
                            <div className="sale-product-input-field">
                                <label>Single Price</label>
                                <br />
                                <input
                                    type="number"
                                    name="single_price"
                                    value={product.single_price}
                                    className="sale-small-input"
                                    onChange={(e) => setProduct({ ...product, single_price: e.target.value })}
                                    placeholder="Price"
                                    ref={singlePriceInputRef}
                                    onKeyDown={(e) => handleKeyDown(e, singlePriceInputRef, bagRateInputRef)}
                                />
                            </div>
                            <div className="sale-product-input-field">
                                <label>Bag Rate</label>
                                <br />
                                <input
                                    type="number"
                                    name="bagRate"
                                    value={product.bagRate}
                                    className="sale-small-input"
                                    onChange={(e) => setProduct({ ...product, bagRate: e.target.value })}
                                    placeholder="Bag Rate"
                                    ref={bagRateInputRef}
                                    onKeyDown={(e) => handleKeyDown(e, bagRateInputRef, wageInputRef)}
                                />
                            </div>
                            <div className="sale-product-input-field">
                                <label>Wage</label>
                                <br />
                                <input
                                    type="number"
                                    name="wage"
                                    value={product.wage}
                                    className="sale-small-input"
                                    onChange={(e) => setProduct({ ...product, wage: e.target.value })}
                                    placeholder="Wage"
                                    ref={wageInputRef}
                                    onKeyDown={(e) => handleKeyDown(e, wageInputRef, commissionInputRef)}
                                />
                            </div>
                            <div className="sale-product-input-field">
                                <label>Commission</label>
                                <br />
                                <input
                                    type="number"
                                    name="commission"
                                    value={product.commission}
                                    className="sale-small-input"
                                    onChange={(e) => setProduct({ ...product, commission: e.target.value })}
                                    placeholder="Commission"
                                    ref={commissionInputRef}
                                    onKeyDown={(e) => handleKeyDown(e, commissionInputRef, productNameInputRef)}
                                />
                            </div>
                            <div className="sale-product-input-field sale-entry-buttons">
                                <button
                                    type="button"
                                    className="sale-add-button"
                                    onClick={handleAddProduct}
                                >
                                    Add
                                </button>
                                <button type="submit" className="sale-save-button">
                                    {editingId ? 'Update' : 'Save'}
                                </button>
                            </div>

                        </div>
                    </div>
                    <div className="sale-table-wrapper">
                        <table className="sale-product-table">
                            <thead>
                                <tr>
                                    <th>Product Name</th>
                                    <th>Quantity</th>
                                    <th>Bags</th>
                                    <th>S Price</th>
                                    <th>Price</th>
                                    <th>Bag Rate</th>
                                    <th>Wage</th>
                                    <th>Commission</th>
                                    <th>Actions</th>
                                    <th>Actions</th>
                                </tr>
                            </thead>
                            <tbody>
                                {fields.map((item, index) => (
                                    <tr key={item.id}>
                                        <td className="sale-product-name-cell">
                                            <input
                                                className="sale-product-name-cell sale-textInput" type="text"
                                                {...register(`products.${index}.name`)}
                                                list='product-list'
                                            />
                                        </td>
                                        <datalist id="product-list">
                                            {productList.map((prod, index) => (
                                                <option key={index} value={prod.name} />
                                            ))}
                                        </datalist>
                                        <td className="sale-product-quantity-cell">
                                            <input
                                                className="sale-product-quantity-cell"
                                                type="number"
                                                {...register(`products.${index}.quantity`, { onBlur: () => syncLineAmount(index) })}
                                                onKeyDown={(e) => handleKeyDownforprice(e, "quantity", index)}
                                            />
                                        </td>
                                        <td className="sale-product-quantity-cell">
                                            <input
                                                className="sale-product-quantity-cell"
                                                type="number"
                                                {...register(`products.${index}.bags`, { onBlur: () => syncLineAmount(index) })}
                                                onKeyDown={(e) => handleKeyDownforprice(e, "bags", index)}
                                            />
                                        </td>
                                        <td className="sale-product-quantity-cell">
                                            <input
                                                className="sale-product-quantity-cell"
                                                type="number"
                                                step="0.01"
                                                {...register(`products.${index}.single_price`, { onBlur: () => syncLineAmount(index) })}
                                                onKeyDown={(e) => handleKeyDownforprice(e, "single_price", index)}
                                            />
                                        </td>
                                        <td className="sale-product-quantity-cell">
                                            <input
                                                className="sale-product-quantity-cell"
                                                type="number"
                                                step="0.01"
                                                {...register(`products.${index}.base_price`)}
                                                onKeyDown={(e) => handleKeyDownforprice(e, "base_price", index)}
                                            />
                                        </td>
                                        <td className="sale-product-quantity-cell">
                                            <input
                                                className="sale-product-quantity-cell"
                                                type="number"
                                                step="0.01"
                                                {...register(`products.${index}.bagRate`, { onBlur: () => syncLineAmount(index) })}
                                                onKeyDown={(e) => handleKeyDownforprice(e, "bagRate", index)}
                                            />
                                        </td>
                                        <td className="sale-product-quantity-cell">
                                            <input
                                                className="sale-product-quantity-cell"
                                                type="number"
                                                step="0.01"
                                                {...register(`products.${index}.wage`, { onBlur: () => syncLineAmount(index) })}
                                                onKeyDown={(e) => handleKeyDownforprice(e, "wage", index)}
                                            />
                                        </td>
                                        <td className="sale-product-quantity-cell">
                                            <input
                                                className="sale-product-quantity-cell"
                                                type="number"
                                                step="0.01"
                                                {...register(`products.${index}.commission`, { onBlur: () => syncLineAmount(index) })}
                                                onKeyDown={(e) => handleKeyDownforprice(e, "commission", index)}
                                            />
                                        </td>
                                        <td className="sale-product-quantity-cell">
                                            <button className="sale-product-quantity-cell" type="button" onClick={() => up(index)}>up</button>
                                        </td>
                                        <td className="sale-product-quantity-cell">
                                            <button className="sale-product-quantity-cell" type="button" onClick={() => { remove(index); calculateTotals(); }}>Remove</button>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                    <div className="sale-bill-total-summary">
                    <div className="sale-bill-total-summary-left">
                        <div>
                            <label>Total Weight:</label>
                            <input className='number' type="number" {...register("bill_details.weight")} />
                        </div>
                 
                        <div>
                            <label>Bag Amount Total:</label>
                            <input className='number' type="number" {...register("bill_details.bagAmountTotal")} />
                        </div>
                        <div>
                            <label>Wage Total:</label>
                            <input  className='number' type="number" {...register("bill_details.wageTotal")} />
                        </div>
                        <div>
                            <label>Commission Total:</label>
                            <input className='number' type="number" {...register("bill_details.commissionTotal")} />
                        </div>
                        <div>
                            <label>Freight:</label>
                            <input
                                type="number"
                                className='number'
                                {...register("bill_details.freight", { onChange: calculateTotals })}
                            />
                        </div>
                       
                        <div>
                            <label>Credit (Cash):</label>
                            <input className='number' type="number" {...register("bill_details.credit")} />
                        </div>
                        <div>
                            <label>Remark:</label>
                            <input type="text" {...register("bill_details.remark")} />
                        </div>
                        <div>
                            <label>
                                <input
                                    type="checkbox"
                                    checked={isSubscribed}
                                    onChange={handleCheckboxChange}
                                />
                                Confirm
                            </label>
                        </div>
                    </div>
                    <div className="sale-bill-total-summary-right">
                        <div className="sale-summary-value-row">
                            <span className="sale-summary-label">Total Quantity:</span>
                            <input type="hidden" {...register("bill_details.total_quantity")} />
                            <span className="sale-summary-value">{watch("bill_details.total_quantity") || 0}</span>
                        </div>
                         <div className="sale-summary-value-row">
                            <span className="sale-summary-label">Total Bag Quantity:</span>
                            <input type="hidden" {...register("bill_details.bag_quantity")} />
                            <span className="sale-summary-value">{watch("bill_details.bag_quantity") || 0}</span>
                        </div>
                               <div className="sale-summary-value-row">
                            <span className="sale-summary-label">Subtotal:</span>
                            <input type="hidden" {...register("bill_details.subtotal")} />
                            <span className="sale-summary-value">{watch("bill_details.subtotal") || 0}</span>
                        </div>
                         <div className="sale-summary-value-row">
                            <span className="sale-summary-label">Grand Total:</span>
                            <input type="hidden" {...register("bill_details.bill_amount")} />
                            <span className="sale-summary-value">{watch("bill_details.bill_amount") || 0}</span>
                        </div>
                        <div className="sale-summary-value-row">
                            <span className="sale-summary-label">Opening Balance:</span>
                            <input type="hidden" {...register("bill_details.old_balance")} />
                            <span className="sale-summary-value">{watch("bill_details.old_balance") || 0}</span>
                        </div>
                        <div className="sale-summary-value-row">
                            <span className="sale-summary-label">Closing Balance:</span>
                            <input type="hidden" {...register("bill_details.balance")} />
                            <span className="sale-summary-value">{watch("bill_details.balance") || 0}</span>
                        </div>
                        <div className="sale-summary-value-row">
                            <span className="sale-summary-label">Debit (Paymt):</span>
                            <input type="hidden" {...register("bill_details.debit")} />
                            <span className="sale-summary-value">{watch("bill_details.debit") || 0}</span>
                        </div>
                        <div className="sale-summary-buttons sale-bill-actions">
                            <button type="submit">{editingId ? 'Update' : 'Submit'}</button>
                            <button type="button" onClick={handleNewSale}>New</button>
                            {/* <button type="submit">Save</button> */}
                            <button
                                type="button"
                                onClick={() => handlePrintBill(lastSavedBill)}
                                disabled={!lastSavedBill}
                                title={lastSavedBill ? `Print bill ${lastSavedBill.bill_details?.order_sno || ''}` : 'Save a sale first to print the last bill'}
                            >Last Bill Print</button>
                            <button type="button" className="sale-bill-delete-button" onClick={handleDeleteSelected}>Delete</button>
                        </div>
                    </div>
                    </div>
                    {editingId && <p role="status">Editing sale {getValues('bill_details.order_sno') || editingId}. Press “new” to cancel.</p>}
                    {saveStatus && <p role="alert">{saveStatus}</p>}
                </form>
            </div>
            <div className="sale-entry-sidebar">
            <div className="sale-entry-summary">
                <div className="sale-summary-filters">
                    <div>
                        <input
                            type="date"
                            value={saleFilter.startDate}
                            max={saleFilter.endDate || undefined}
                            onChange={(e) => setSaleFilter({ ...saleFilter, startDate: e.target.value })}
                        />
                    </div>
                    <div>
                        <input
                            type="date"
                            value={saleFilter.endDate}
                            min={saleFilter.startDate || undefined}
                            onChange={(e) => setSaleFilter({ ...saleFilter, endDate: e.target.value })}
                        />
                    </div>
                </div>
                <div
                    className="sale-summary-content"
                    ref={saleSummaryContentRef}
                    tabIndex={0}
                    onKeyDown={handleSummaryKeyDown}
                >
                    <table>
                        <tbody>
                            <tr>
                                <td>
                                    <input
                                        type="checkbox"
                                        checked={saleSummary.length > 0 && selectedIds.size === saleSummary.length}
                                        onChange={toggleSelectAll}
                                    />
                                </td>
                                <td>S.no</td>
                                <td>customer</td>
                                <td>biled</td>
                                <td>print</td>
                                <td>views</td>
                                <td>edit</td>
                            </tr>
                            {saleSummary.map((sale, index) => (
                                <tr
                                    key={sale._id}
                                    className={index === selectedRow ? 'sale-row-selected' : undefined}
                                    onClick={() => { setSelectedRow(index); handleEdit(sale); }}
                                >
                                    <td>
                                        <input
                                            type="checkbox"
                                            checked={selectedIds.has(sale._id)}
                                            onClick={(e) => e.stopPropagation()}
                                            onChange={() => toggleSelectRow(sale._id)}
                                        />
                                    </td>
                                    <td>{sale.bill_details?.order_sno || '—'}</td>
                                    <td>{sale.customer?.name || '—'}</td>
                                    <td>{sale.bill_details?.billed ? 'Billed' : 'Pending'}</td>
                                    <td><button type="button" onClick={(e) => { e.stopPropagation(); handlePrintBill(sale); }}>print</button></td>
                                    <td><button type="button" onClick={(e) => { e.stopPropagation(); setViewSale(sale); }}>view</button></td>
                                    <td><button type="button" onClick={(e) => { e.stopPropagation(); setSelectedRow(index); handleEdit(sale); }}>edit</button></td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                    {summaryStatus && <p role="status">{summaryStatus}</p>}
                </div>
                
            </div>
            <div className="sale-summary-buttons">
                    <div><button type="button">Total sale</button></div>
                    <div><button type="button" onClick={handlePrintByCustomer}>mixer</button></div>
                    <div><button type="button" onClick={() => handlePrintSales(false)}>print selected ({selectedIds.size})</button></div>
                    <div><button type="button" onClick={() => handlePrintSales(true)}>print all</button></div>
                    <div><button type="button" onClick={handleDeleteSelected}>delete ({selectedIds.size})</button></div>
                </div>
                <hr></hr>
            {/* Order (purchase) bill list — same layout/behaviour as the sale list above, wired to /api/orders. */}
            <div className="sale-entry-summary">
                <div className="sale-summary-filters">
                    <div>
                        <input
                            type="date"
                            value={orderFilter.startDate}
                            max={orderFilter.endDate || undefined}
                            onChange={(e) => setOrderFilter({ ...orderFilter, startDate: e.target.value })}
                        />
                    </div>
                    <div>
                        <input
                            type="date"
                            value={orderFilter.endDate}
                            min={orderFilter.startDate || undefined}
                            onChange={(e) => setOrderFilter({ ...orderFilter, endDate: e.target.value })}
                        />
                    </div>
                </div>
                <div
                    className="sale-summary-content"
                    tabIndex={0}
                    onKeyDown={handleOrderSummaryKeyDown}
                >
                    <table>
                        <tbody>
                            <tr>
                                <td>
                                    <input
                                        type="checkbox"
                                        checked={orderListSummary.length > 0 && orderSelectedIds.size === orderListSummary.length}
                                        onChange={toggleOrderSelectAll}
                                    />
                                </td>
                                <td>S.no</td>
                                <td>customer</td>
                                <td>biled</td>
                                <td>print</td>
                                <td>views</td>
                                <td>edit</td>
                            </tr>
                            {orderListSummary.map((order, index) => (
                                <tr
                                    key={order._id}
                                    className={index === orderSelectedRow ? 'sale-row-selected' : undefined}
                                    onClick={() => setOrderSelectedRow(index)}
                                >
                                    <td>
                                        <input
                                            type="checkbox"
                                            checked={orderSelectedIds.has(order._id)}
                                            onClick={(e) => e.stopPropagation()}
                                            onChange={() => toggleOrderSelectRow(order._id)}
                                        />
                                    </td>
                                    <td>{order.bill_details?.order_sno || '—'}</td>
                                    <td>{order.customer?.name || '—'}</td>
                                    <td>{order.bill_details?.billed ? 'Billed' : 'Pending'}</td>
                                    <td><button type="button" onClick={(e) => { e.stopPropagation(); handlePrintBill(order); }}>print</button></td>
                                    <td><button type="button" onClick={(e) => { e.stopPropagation(); setViewOrderBill(order); }}>view</button></td>
                                    <td><button type="button" title="Fill Sale Entry from this order" onClick={(e) => { e.stopPropagation(); handleUseOrderForSale(order); }}>edit</button></td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                    {orderListStatus && <p role="status">{orderListStatus}</p>}
                </div>
              
            </div>
              <div className="sale-summary-buttons">
                    <div><button type="button">Total order</button></div>
                    <div><button type="button" onClick={() => handlePrintOrders(false)}>print selected ({orderSelectedIds.size})</button></div>
                    <div><button type="button" onClick={() => handlePrintOrders(true)}>print all</button></div>
                    <div><button type="button" onClick={handleDeleteSelectedOrders}>delete ({orderSelectedIds.size})</button></div>
                </div>
            </div>

            {viewOrderBill && (
                <div className="sale-view-overlay" onClick={() => setViewOrderBill(null)}>
                    <div className="sale-view-modal" onClick={(e) => e.stopPropagation()}>
                        <div className="sale-view-header">
                            <h3>Order details</h3>
                            <button type="button" onClick={() => setViewOrderBill(null)}>✕</button>
                        </div>
                        <div className="sale-view-meta">
                            <div><span>Bill No.</span><strong>{viewOrderBill.bill_details?.order_sno || '—'}</strong></div>
                            <div><span>Customer</span><strong>{viewOrderBill.customer?.name || '—'}</strong></div>
                            <div><span>Date</span><strong>{toDateInput(viewOrderBill.bill_details?.date)}</strong></div>
                            <div><span>Status</span><strong>{viewOrderBill.bill_details?.billed ? 'Billed' : 'Pending'}</strong></div>
                        </div>
                        <table className="sale-view-table">
                            <thead>
                                <tr><th>Product</th><th>Qty</th><th>Bags</th><th>Scale</th><th>Single price</th><th>Amount</th><th>Bag amt</th><th>Wage</th><th>Comm.</th></tr>
                            </thead>
                            <tbody>
                                {(viewOrderBill.products || []).map((item, index) => (
                                    <tr key={index}>
                                        <td>{item.name}</td>
                                        <td>{item.quantity}</td>
                                        <td>{item.bags}</td>
                                        <td>{item.scale || '—'}</td>
                                        <td>{item.single_price}</td>
                                        <td>{item.base_price}</td>
                                        <td>{item.bagAmount}</td>
                                        <td>{item.wageAmount}</td>
                                        <td>{item.commissionAmount}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                        <div className="sale-view-totals">
                            <div><span>Total quantity</span><strong>{viewOrderBill.bill_details?.total_quantity || 0}</strong></div>
                            <div><span>Total bags</span><strong>{viewOrderBill.bill_details?.bag_quantity || 0}</strong></div>
                            <div><span>Weight</span><strong>{viewOrderBill.bill_details?.weight || 0}</strong></div>
                            <div><span>Subtotal</span><strong>₹{Number(viewOrderBill.bill_details?.subtotal || 0).toFixed(2)}</strong></div>
                            <div><span>Bag amount</span><strong>₹{Number(viewOrderBill.bill_details?.bagAmountTotal || 0).toFixed(2)}</strong></div>
                            <div><span>Wage</span><strong>₹{Number(viewOrderBill.bill_details?.wageTotal || 0).toFixed(2)}</strong></div>
                            <div><span>Commission</span><strong>₹{Number(viewOrderBill.bill_details?.commissionTotal || 0).toFixed(2)}</strong></div>
                            <div><span>Freight</span><strong>₹{Number(viewOrderBill.bill_details?.freight || 0).toFixed(2)}</strong></div>
                            <div><span>Grand total</span><strong>₹{Number(viewOrderBill.bill_details?.bill_amount || 0).toFixed(2)}</strong></div>
                        </div>
                        <div className="sale-view-actions">
                            <a href="/order-entry">Go to Order Entry</a>
                            <button type="button" onClick={() => setViewOrderBill(null)}>Close</button>
                        </div>
                    </div>
                </div>
            )}

            {viewSale && (
                <div className="sale-view-overlay" onClick={() => setViewSale(null)}>
                    <div className="sale-view-modal" onClick={(e) => e.stopPropagation()}>
                        <div className="sale-view-header">
                            <h3>Sale details</h3>
                            <button type="button" onClick={() => setViewSale(null)}>✕</button>
                        </div>
                        <div className="sale-view-meta">
                            <div><span>Bill No.</span><strong>{viewSale.bill_details?.order_sno || '—'}</strong></div>
                            <div><span>Customer</span><strong>{viewSale.customer?.name || '—'}</strong></div>
                            <div><span>Date</span><strong>{toDateInput(viewSale.bill_details?.date)}</strong></div>
                            <div><span>Status</span><strong>{viewSale.bill_details?.billed ? 'Billed' : 'Pending'}</strong></div>
                        </div>
                        <table className="sale-view-table">
                            <thead>
                                <tr><th>Product</th><th>Qty</th><th>Bags</th><th>Scale</th><th>Single price</th><th>Amount</th><th>Bag amt</th><th>Wage</th><th>Comm.</th></tr>
                            </thead>
                            <tbody>
                                {(viewSale.products || []).map((item, index) => (
                                    <tr key={index}>
                                        <td>{item.name}</td>
                                        <td>{item.quantity}</td>
                                        <td>{item.bags}</td>
                                        <td>{item.scale || '—'}</td>
                                        <td>{item.single_price}</td>
                                        <td>{item.base_price}</td>
                                        <td>{item.bagAmount}</td>
                                        <td>{item.wageAmount}</td>
                                        <td>{item.commissionAmount}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                        <div className="sale-view-totals">
                            <div><span>Total quantity</span><strong>{viewSale.bill_details?.total_quantity || 0}</strong></div>
                            <div><span>Total bags</span><strong>{viewSale.bill_details?.bag_quantity || 0}</strong></div>
                            <div><span>Weight</span><strong>{viewSale.bill_details?.weight || 0}</strong></div>
                            <div><span>Subtotal</span><strong>₹{Number(viewSale.bill_details?.subtotal || 0).toFixed(2)}</strong></div>
                            <div><span>Bag amount</span><strong>₹{Number(viewSale.bill_details?.bagAmountTotal || 0).toFixed(2)}</strong></div>
                            <div><span>Wage</span><strong>₹{Number(viewSale.bill_details?.wageTotal || 0).toFixed(2)}</strong></div>
                            <div><span>Commission</span><strong>₹{Number(viewSale.bill_details?.commissionTotal || 0).toFixed(2)}</strong></div>
                            <div><span>Freight</span><strong>₹{Number(viewSale.bill_details?.freight || 0).toFixed(2)}</strong></div>
                            <div><span>Grand total</span><strong>₹{Number(viewSale.bill_details?.bill_amount || 0).toFixed(2)}</strong></div>
                        </div>
                        <div className="sale-view-actions">
                            <button type="button" onClick={() => { handleEdit(viewSale); setViewSale(null); }}>Edit this sale</button>
                            <button type="button" onClick={() => setViewSale(null)}>Close</button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
export default SaleEntry;
