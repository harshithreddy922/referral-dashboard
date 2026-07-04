import { useEffect, useMemo, useState } from 'react';
import Cookies from 'js-cookie';
import {
  BrowserRouter,
  Link,
  Navigate,
  Route,
  Routes,
  useNavigate,
  useParams,
} from 'react-router-dom';

const LOGIN_URL =
  'https://v9fes04dwf.execute-api.eu-north-1.amazonaws.com/api/auth/signin';
const REFERRALS_URL =
  'https://v9fes04dwf.execute-api.eu-north-1.amazonaws.com/api/referrals';
const TOKEN_COOKIE = 'jwt_token';
const PAGE_SIZE = 10;

function getToken() {
  return Cookies.get(TOKEN_COOKIE);
}

function setToken(token) {
  Cookies.set(TOKEN_COOKIE, token);
}

function removeToken() {
  Cookies.remove(TOKEN_COOKIE);
}

function formatDate(dateString) {
  if (!dateString) return '';
  return String(dateString).split('T')[0].replaceAll('-', '/');
}

function formatCurrency(value) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(Number(value || 0));
}

function isZeroLike(value) {
  if (value === undefined || value === null || value === '') return true;
  return String(value).replace(/[^0-9.-]/g, '') === '0';
}

function getReferralId(row) {
  return row?.id ?? row?.referralId ?? row?._id;
}

function normalizeData(payload) {
  const data = payload?.data ?? payload ?? {};
  const nested = data?.data ?? {};
  const metrics = data.metrics ?? nested.metrics ?? [];
  const serviceSummary = data.serviceSummary ?? nested.serviceSummary ?? {};
  const referral = data.referral ?? nested.referral ?? {};
  const referrals = data.referrals ?? nested.referrals ?? [];
  const totalReferralMetric = metrics.find((metric) => metric.id === 'totalRef');
  const totalReferralCount = totalReferralMetric?.value ?? String(referrals.length);
  const totalReferralProfit = referrals.reduce(
    (sum, row) => sum + Number(row?.profit || 0),
    0,
  );

  return {
    metrics,
    serviceSummary: {
      service: serviceSummary.service ?? referrals[0]?.serviceName ?? '',
      yourReferrals: isZeroLike(serviceSummary.yourReferrals)
        ? totalReferralCount
        : serviceSummary.yourReferrals,
      activeReferrals: isZeroLike(serviceSummary.activeReferrals)
        ? totalReferralCount
        : serviceSummary.activeReferrals,
      totalRefEarnings: isZeroLike(serviceSummary.totalRefEarnings)
        ? formatCurrency(totalReferralProfit)
        : serviceSummary.totalRefEarnings,
    },
    referral,
    referrals,
  };
}

function normalizeDetail(payload, requestedId) {
  const data = payload?.data ?? payload ?? {};
  const candidates = [
    data,
    data.referral,
    ...(Array.isArray(data.referrals) ? data.referrals : []),
    ...(Array.isArray(data.data?.referrals) ? data.data.referrals : []),
    data.data,
  ].filter(Boolean);

  return candidates.find((item) => {
    const itemId = getReferralId(item);
    return itemId !== undefined && String(itemId) === String(requestedId);
  });
}

async function readError(response) {
  try {
    const body = await response.json();
    return body?.message
      ? `${body.message} (${response.status})`
      : `Request failed (${response.status})`;
  } catch {
    return `Request failed (${response.status})`;
  }
}

function ProtectedRoute({ children }) {
  return getToken() ? children : <Navigate to="/login" replace />;
}

function PublicOnlyRoute({ children }) {
  return getToken() ? <Navigate to="/" replace /> : children;
}

function Navbar() {
  const navigate = useNavigate();

  function handleLogout() {
    removeToken();
    navigate('/login', { replace: true });
  }

  return (
    <header className="navbar">
      <Link className="brand" to="/" aria-label="Go to dashboard home">
        Go Business
      </Link>
      <nav className="primary-nav" aria-label="Primary">
        <Link to="/">Home</Link>
      </nav>
      <button className="button button-secondary" type="button" onClick={handleLogout}>
        Log out
      </button>
    </header>
  );
}

function LoginPage() {
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(event) {
    event.preventDefault();
    setError('');
    setIsSubmitting(true);

    try {
      const response = await fetch(LOGIN_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      const responseJson = await response.json();

      if (!response.ok) {
        setError(responseJson?.message || 'Invalid email or password');
        return;
      }

      const token = responseJson?.data?.token;
      if (!token) {
        setError('Login succeeded but no token was returned.');
        return;
      }

      setToken(token);
      navigate('/', { replace: true });
    } catch (err) {
      setError(err?.message || 'Unable to sign in. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <main className="login-shell">
      <section className="login-panel" aria-labelledby="login-title">
        <div>
          <p className="eyebrow">Referral management</p>
          <h1 id="login-title">Go Business</h1>
          <p className="login-tagline">Sign in to open your referral dashboard.</p>
        </div>

        <form className="login-form" onSubmit={handleSubmit}>
          <div className="field">
            <label htmlFor="email">Email</label>
            <input
              id="email"
              name="email"
              type="email"
              placeholder="you@example.com"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
          </div>

          <div className="field">
            <label htmlFor="password">Password</label>
            <input
              id="password"
              name="password"
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          </div>

          {error ? (
            <p className="error-text" role="alert">
              {error}
            </p>
          ) : null}

          <button className="button button-primary" type="submit">
            Sign in
          </button>
        </form>
      </section>
    </main>
  );
}

function DashboardPage() {
  const [dashboardData, setDashboardData] = useState({
    metrics: [],
    serviceSummary: {},
    referral: {},
    referrals: [],
  });
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState('desc');
  const [page, setPage] = useState(1);
  const [tableLoading, setTableLoading] = useState(true);
  const [hasLoadedDashboard, setHasLoadedDashboard] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    const controller = new AbortController();
    let isCurrent = true;

    async function fetchReferrals() {
      setTableLoading(true);
      setError('');

      try {
        const params = new URLSearchParams();
        if (search.trim()) params.set('search', search.trim());
        if (sort) params.set('sort', sort);

        const url = params.toString()
          ? `${REFERRALS_URL}?${params.toString()}`
          : REFERRALS_URL;

        const response = await fetch(url, {
          headers: { Authorization: `Bearer ${getToken()}` },
          signal: controller.signal,
        });

        if (!response.ok) {
          throw new Error(await readError(response));
        }

        const payload = await response.json();
        if (!isCurrent) return;
        setDashboardData(normalizeData(payload));
        setHasLoadedDashboard(true);
        setPage(1);
      } catch (err) {
        if (isCurrent && err.name !== 'AbortError') {
          setError(err?.message || 'Unable to load referrals.');
        }
      } finally {
        if (isCurrent) {
          setTableLoading(false);
        }
      }
    }

    fetchReferrals();
    return () => {
      isCurrent = false;
      controller.abort();
    };
  }, [search, sort]);

  const totalEntries = dashboardData.referrals.length;
  const totalPages = Math.max(1, Math.ceil(totalEntries / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const from = totalEntries === 0 ? 0 : (currentPage - 1) * PAGE_SIZE + 1;
  const to = Math.min(currentPage * PAGE_SIZE, totalEntries);
  const pageRows = useMemo(() => {
    const start = (currentPage - 1) * PAGE_SIZE;
    return dashboardData.referrals.slice(start, start + PAGE_SIZE);
  }, [dashboardData.referrals, currentPage]);

  return (
    <>
      <Navbar />
      <main className="page-shell">
        <section className="dashboard-header">
          <div>
            <p className="eyebrow">Partner growth</p>
            <h1>Referral Dashboard</h1>
            <p>Track your referrals, earnings, and partner activity in one place.</p>
          </div>
        </section>

        {!hasLoadedDashboard && tableLoading ? (
          <p className="state-message">Loading referrals...</p>
        ) : null}
        {error && !hasLoadedDashboard ? (
          <p className="error-banner" role="alert">
            {error}
          </p>
        ) : null}

        {hasLoadedDashboard ? (
          <>
            <section
              className="section-panel"
              aria-label="Overview metrics"
              aria-labelledby="overview-title"
              role="region"
            >
              <h2 id="overview-title">Overview</h2>
              <div className="metrics-grid">
                {dashboardData.metrics.map((metric) => (
                  <article className="metric-card" key={metric.id ?? metric.label}>
                    <p>{metric.label}</p>
                    <strong>{metric.value}</strong>
                  </article>
                ))}
              </div>
            </section>

            <div className="split-grid">
              <section
                className="section-panel"
                aria-label="Service summary"
                aria-labelledby="service-summary-title"
              >
                <h2 id="service-summary-title">Service summary</h2>
                <dl className="summary-list">
                  <div>
                    <dt>Service</dt>
                    <dd>{dashboardData.serviceSummary.service}</dd>
                  </div>
                  <div>
                    <dt>Your Referrals</dt>
                    <dd>{dashboardData.serviceSummary.yourReferrals}</dd>
                  </div>
                  <div>
                    <dt>Active Referrals</dt>
                    <dd>{dashboardData.serviceSummary.activeReferrals}</dd>
                  </div>
                  <div>
                    <dt>Total Ref. Earnings</dt>
                    <dd>{dashboardData.serviceSummary.totalRefEarnings}</dd>
                  </div>
                </dl>
              </section>

              <section
                className="section-panel"
                aria-label="Share referral"
                aria-labelledby="share-referral-title"
              >
                <h2 id="share-referral-title">Refer friends and earn more</h2>
                <CopyField label="Your Referral Link" value={dashboardData.referral.link} />
                <CopyField label="Your Referral Code" value={dashboardData.referral.code} />
              </section>
            </div>

            <section className="section-panel table-section" aria-labelledby="all-referrals-title">
              <div className="table-heading">
                <h2 id="all-referrals-title">All referrals</h2>
                <div className="table-controls">
                  <input
                    aria-label="Search referrals"
                    type="search"
                    placeholder={`Name or service${'\u2026'}`}
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                  />
                  <label className="sort-label">
                    Sort by date
                    <select value={sort} onChange={(event) => setSort(event.target.value)}>
                      <option value="desc">Newest first</option>
                      <option value="asc">Oldest first</option>
                    </select>
                  </label>
                </div>
              </div>

              {error ? (
                <p className="error-banner table-error" role="alert">
                  {error}
                </p>
              ) : null}

              <ReferralsTable rows={pageRows} isLoading={tableLoading} />

              <div className="pagination-row">
                <p>
                  Showing {from}
                  {'\u2013'}
                  {to} of {totalEntries} entries
                </p>
                <div className="pagination-actions" aria-label="Pagination">
                  <button
                    className="button button-secondary"
                    type="button"
                    disabled={currentPage === 1}
                    onClick={() => setPage((value) => Math.max(1, value - 1))}
                  >
                    Previous
                  </button>
                  {totalPages > 1
                    ? Array.from({ length: totalPages }, (_, index) => index + 1).map(
                        (pageNumber) => (
                          <button
                            className={
                              pageNumber === currentPage
                                ? 'page-button active'
                                : 'page-button'
                            }
                            type="button"
                            key={pageNumber}
                            aria-current={pageNumber === currentPage ? 'page' : undefined}
                            onClick={() => setPage(pageNumber)}
                          >
                            {pageNumber}
                          </button>
                        ),
                      )
                    : null}
                  <button
                    className="button button-secondary"
                    type="button"
                    disabled={currentPage === totalPages}
                    onClick={() => setPage((value) => Math.min(totalPages, value + 1))}
                  >
                    Next
                  </button>
                </div>
              </div>
            </section>
          </>
        ) : null}
      </main>
      <DashboardFooter />
    </>
  );
}

function CopyField({ label, value = '' }) {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1400);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div className="copy-field">
      <label>
        {label}
        <input readOnly value={value} />
      </label>
      <button className="button button-secondary" type="button" onClick={handleCopy}>
        Copy
      </button>
      <span className="copy-status" aria-live="polite">
        {copied ? 'Copied' : ''}
      </span>
    </div>
  );
}

function ReferralsTable({ rows, isLoading }) {
  const navigate = useNavigate();

  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th scope="col">Name</th>
            <th scope="col">Service</th>
            <th scope="col">Date</th>
            <th scope="col">Profit</th>
          </tr>
        </thead>
        <tbody>
          {isLoading ? (
            <tr>
              <td colSpan="4" className="empty-state">
                Loading matching entries...
              </td>
            </tr>
          ) : rows.length > 0 ? (
            rows.map((row) => (
              <tr
                key={getReferralId(row)}
                tabIndex={0}
                onClick={() => navigate(`/referral/${getReferralId(row)}`)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    navigate(`/referral/${getReferralId(row)}`);
                  }
                }}
              >
                <td>{row.name}</td>
                <td>{row.serviceName}</td>
                <td>{formatDate(row.date)}</td>
                <td>{formatCurrency(row.profit)}</td>
              </tr>
            ))
          ) : (
            <tr>
              <td colSpan="4" className="empty-state">
                No matching entries
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

function ReferralDetailPage() {
  const { id } = useParams();
  const [referral, setReferral] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    const controller = new AbortController();
    let isCurrent = true;

    async function fetchReferral() {
      setLoading(true);
      setError('');
      setReferral(null);

      try {
        const params = new URLSearchParams({ id });
        const response = await fetch(`${REFERRALS_URL}?${params.toString()}`, {
          headers: { Authorization: `Bearer ${getToken()}` },
          signal: controller.signal,
        });

        if (!response.ok) {
          throw new Error(await readError(response));
        }

        const payload = await response.json();
        const matchedReferral = normalizeDetail(payload, id);
        if (!isCurrent) return;
        setReferral(matchedReferral || null);
      } catch (err) {
        if (isCurrent && err.name !== 'AbortError') {
          setError(err?.message || 'Unable to load referral.');
        }
      } finally {
        if (isCurrent) {
          setLoading(false);
        }
      }
    }

    fetchReferral();
    return () => {
      isCurrent = false;
      controller.abort();
    };
  }, [id]);

  return (
    <>
      <Navbar />
      <main className="page-shell detail-shell">
        {loading ? <p className="state-message">Loading referral...</p> : null}
        {error ? (
          <p className="error-banner" role="alert">
            {error}
          </p>
        ) : null}
        {!loading && !error && !referral ? <ReferralNotFound /> : null}
        {!loading && !error && referral ? (
          <section className="section-panel detail-panel">
            <Link className="back-link" to="/">
              {'\u2190'} Back to dashboard
            </Link>
            <p className="eyebrow">Referral profile</p>
            <h1>Referral Details</h1>
            <h2>{referral.name}</h2>
            <dl className="summary-list detail-list">
              <div>
                <dt>Referral ID</dt>
                <dd>{getReferralId(referral)}</dd>
              </div>
              <div>
                <dt>Service Name</dt>
                <dd>{referral.serviceName}</dd>
              </div>
              <div>
                <dt>Date</dt>
                <dd>{formatDate(referral.date)}</dd>
              </div>
              <div>
                <dt>Profit</dt>
                <dd>{formatCurrency(referral.profit)}</dd>
              </div>
            </dl>
          </section>
        ) : null}
      </main>
    </>
  );
}

function ReferralNotFound() {
  return (
    <section className="section-panel not-found-panel">
      <h1>Referral not found</h1>
      <Link className="button button-primary" to="/">
        Back to dashboard
      </Link>
    </section>
  );
}

function NotFoundPage() {
  return (
    <main className="not-found-page">
      <section className="section-panel not-found-panel">
        <p className="not-found-code">404</p>
        <h1>Page not found</h1>
        <p>404 - Page Not Found</p>
        <Link className="button button-primary" to="/">
          Back to dashboard
        </Link>
      </section>
    </main>
  );
}

function DashboardFooter() {
  return (
    <footer className="footer">
      <p>{'\u00A9'} 2024 Go Business</p>
      <nav aria-label="Footer">
        <a href="#about">About</a>
        <a href="#privacy">Privacy</a>
      </nav>
    </footer>
  );
}

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route
          path="/login"
          element={
            <PublicOnlyRoute>
              <LoginPage />
            </PublicOnlyRoute>
          }
        />
        <Route
          path="/"
          element={
            <ProtectedRoute>
              <DashboardPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/dashboard/referrals"
          element={
            <ProtectedRoute>
              <Navigate to="/" replace />
            </ProtectedRoute>
          }
        />
        <Route
          path="/referral/:id"
          element={
            <ProtectedRoute>
              <ReferralDetailPage />
            </ProtectedRoute>
          }
        />
        <Route path="*" element={<NotFoundPage />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
