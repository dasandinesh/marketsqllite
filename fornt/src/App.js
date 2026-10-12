import './App.css';
import React, { useEffect, useRef } from 'react';
import { BrowserRouter as Router, Route, Routes, useLocation } from 'react-router-dom';
import OrderEntryResponsive from './components/order/orderentryresponsive';
import OrderEntryMobile from './components/order/ordermobile';
import SaleEntry from './components/sale/saleentry';
import MainNav from './components/navbar/mainnav';
import MainFooter from './components/footer/mainfooter';
import CustomerAdd from './components/cutomer/customeradd';
import CustomerList from './components/cutomer/customerlist';
import CustomerDetails from './components/cutomer/customerdetails';
import ProductAdd from './components/product/productadd';
import ProductList from './components/product/productlist';
import OrderList from './components/order/orderlist';
import InvoiceSetting from './components/invoice/invoicesetting';
import ReceiptEntry from './components/accounts/receiptentry';
import SaleBillList from './components/sale/salebilllist';
import CustomerLedger from './components/accounts/customerledger';
import Dashboard from './components/home/dashboard';
import Price from './components/sale/price';
import OrderPrice from './components/order/price';
import DriverAdd from './components/driver/driveradd';
import DriverList from './components/driver/driverlist';
import VehicleAdd from './components/vehicle/vehicleadd';
import VehicleList from './components/vehicle/vehiclelist';
import AtlasSync from './components/atlas/AtlasSync';
import Preferences from './components/preferences/Preferences';
import './responsive.css';

// Select an input's value when it gets focus, so typing replaces it without Backspace.
// One document-level listener covers every page and every input.
const selectOnFocus = (e) => {
  const el = e.target;
  if (el.tagName === 'INPUT' && (el.type === 'text' || el.type === 'number')) el.select();
};

function AppLayout({ children }) {
  const { pathname } = useLocation();
  const contentRef = useRef(null);
  useEffect(() => {
    contentRef.current?.scrollTo({ top: 0, left: 0, behavior: 'instant' });
    window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
  }, [pathname]);
  return (
    <div className="app-shell">
      <MainNav />
      <main className="app-content" ref={contentRef}>{children}</main>
      <MainFooter />
    </div>
  );
}

function App() {
  useEffect(() => {
    document.addEventListener('focusin', selectOnFocus);
    return () => document.removeEventListener('focusin', selectOnFocus);
  }, []);

  return (
    <Router>
      <AppLayout>
          <Routes>
            <Route path="/dashboard" element={<Dashboard />} />
            <Route path="/order-entry" element={<OrderEntryResponsive />} />
            <Route path="/order-entry-mobile" element={<OrderEntryMobile />} />
            <Route path="/customers" element={<CustomerAdd />} />
            <Route path="/customer-list" element={<CustomerList />} />
            <Route path="/customer-list/:id" element={<CustomerDetails />} />
            <Route path="/products" element={<ProductAdd />} />
            <Route path="/product-list" element={<ProductList />} />
            <Route path="/drivers" element={<DriverAdd />} />
            <Route path="/driver-list" element={<DriverList />} />
            <Route path="/vehicles" element={<VehicleAdd />} />
            <Route path="/vehicle-list" element={<VehicleList />} />
            <Route path="/order-list" element={<OrderList />} />
            <Route path="/order-price-update" element={<OrderPrice />} />
            <Route path="/sale-entry" element={<SaleEntry />} />
            <Route path="/sale-list" element={<SaleBillList />} />
            <Route path="/price-update" element={<Price />} />
            <Route path="/invoice-setting" element={<InvoiceSetting />} />
            <Route path="/receipts" element={<ReceiptEntry />} />
            <Route path="/customer-ledger" element={<CustomerLedger />} />
            <Route path="/atlas-sync" element={<AtlasSync />} />
            <Route path="/preferences" element={<Preferences />} />
          </Routes>
      </AppLayout>
    </Router>
  );
}

export default App;
