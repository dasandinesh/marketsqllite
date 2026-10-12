import { useEffect, useRef, useState } from 'react';
import { NavLink } from 'react-router-dom';
import NavIcon from './navicons';
import './mainnav.css';

const DASHBOARD_LINK = { to: '/dashboard', label: 'Dashboard', icon: 'dashboard' };

const TRANSACTION_LINKS = [
  { to: '/order-entry', label: 'Orders', icon: 'cart' },
  { to: '/order-list', label: 'Order List', icon: 'clipboard' },
  { to: '/sale-entry', label: 'Sales', icon: 'tag' },
  { to: '/sale-list', label: 'Sale Bills', icon: 'fileText' },
];

const NAV_LINKS = [
  { to: '/order-entry-mobile', label: 'Orders (Mobile)', icon: 'cart' },
];

const MASTER_LINKS = [
  { to: '/customer-list', label: 'Customer', icon: 'users' },
  { to: '/product-list', label: 'Product', icon: 'box' },
  { to: '/driver-list', label: 'Driver', icon: 'users' },
  { to: '/vehicle-list', label: 'Vehicle', icon: 'truck' },
  { to: '/invoice-setting', label: 'Invoice Setting', icon: 'gear' },
  { to: '/atlas-sync', label: 'Atlas Sync', icon: 'cloud' },
];

// Grouped into their own dropdown — with 10+ top-level links the two Price Update
// pages were easy to miss buried inline, so they get a clearly-labeled home instead.
const PRICE_LINKS = [
  { to: '/price-update', label: 'Sale Price Update', icon: 'pencil' },
  { to: '/order-price-update', label: 'Order Price Update', icon: 'pencil' },
];

const ACCOUNT_LINKS = [
  { to: '/receipts', label: 'Receipts', icon: 'receipt' },
  { to: '/customer-ledger', label: 'Customer Ledger', icon: 'book' },
];

const linkClass = ({ isActive }) => `mainnav-link${isActive ? ' is-active' : ''}`;

const NavDropdown = ({ id, label, icon, links, onNavigate, openId, onToggle }) => {
  const isOpen = openId === id;
  return (
    <div className={`mainnav-dropdown${isOpen ? ' is-open' : ''}`}>
      <button
        type="button"
        className="mainnav-dropdown-toggle"
        aria-expanded={isOpen}
        onClick={() => onToggle(id)}
      >
        <NavIcon name={icon} />
        <span>{label}</span>
      </button>
      <div className="mainnav-dropdown-menu">
        {links.map((link) => (
          <NavLink key={link.to} to={link.to} className={linkClass} onClick={onNavigate}>
            <NavIcon name={link.icon} />
            <span>{link.label}</span>
          </NavLink>
        ))}
      </div>
    </div>
  );
};

const MainNav = () => {
  // Bootstrap-style collapsible nav: hidden behind a hamburger toggler under the
  // mobile breakpoint, always visible above it (handled in mainnav.css).
  const [open, setOpen] = useState(false);
  // Which submenu (Master/Accounts) is expanded on mobile — null means both collapsed.
  const [openDropdown, setOpenDropdown] = useState(null);
  const navRef = useRef(null);

  const close = () => {
    setOpen(false);
    setOpenDropdown(null);
  };
  const toggleDropdown = (id) => setOpenDropdown((current) => (current === id ? null : id));

  // Close the mobile menu on outside click or Escape — same as Bootstrap's navbar.
  useEffect(() => {
    if (!open) return undefined;
    const handleClick = (e) => {
      if (navRef.current && !navRef.current.contains(e.target)) close();
    };
    const handleKey = (e) => { if (e.key === 'Escape') close(); };
    document.addEventListener('mousedown', handleClick);
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('mousedown', handleClick);
      document.removeEventListener('keydown', handleKey);
    };
  }, [open]);

  return (
    <nav className="mainnav" aria-label="Main navigation" ref={navRef}>
    

      <button
        type="button"
        className={`mainnav-toggler${open ? ' is-open' : ''}`}
        aria-label="Toggle navigation"
        aria-expanded={open}
        aria-controls="mainnav-links"
        onClick={() => setOpen((v) => !v)}
      >
        <span className="mainnav-toggler-bar" />
        <span className="mainnav-toggler-bar" />
        <span className="mainnav-toggler-bar" />
      </button>

      <div id="mainnav-links" className={`mainnav-links${open ? ' is-open' : ''}`}>
        <NavLink to={DASHBOARD_LINK.to} className={linkClass} onClick={close}>
          <NavIcon name={DASHBOARD_LINK.icon} />
          <span>{DASHBOARD_LINK.label}</span>
        </NavLink>
        <NavDropdown id="master" label="Master" icon="layers" links={MASTER_LINKS} onNavigate={close} openId={openDropdown} onToggle={toggleDropdown} />
        <NavDropdown id="transaction" label="Transaction" icon="receipt" links={TRANSACTION_LINKS} onNavigate={close} openId={openDropdown} onToggle={toggleDropdown} />
        {NAV_LINKS.map((link) => (
          <NavLink key={link.to} to={link.to} className={linkClass} onClick={close}>
            <NavIcon name={link.icon} />
            <span>{link.label}</span>
          </NavLink>
        ))}
        <NavDropdown id="price" label="Price" icon="pencil" links={PRICE_LINKS} onNavigate={close} openId={openDropdown} onToggle={toggleDropdown} />
        <NavDropdown id="accounts" label="Accounts" icon="wallet" links={ACCOUNT_LINKS} onNavigate={close} openId={openDropdown} onToggle={toggleDropdown} />
        <NavLink to="/preferences" className={linkClass} onClick={close}>
          <NavIcon name="gear" /><span>Preferences</span>
        </NavLink>
      </div>

    
    </nav>
  );
};

export default MainNav;
