import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { authAPI } from '../api/client';

const LoginPage = () => {
  const navigate = useNavigate();
  const [isLogin, setIsLogin] = useState(true); // Toggle between Login and Register
  const [formData, setFormData] = useState({
    email: '',
    password: '',
    full_name: '',
  });
  const [errors, setErrors] = useState({});
  const [isLoading, setIsLoading] = useState(false);
  const [apiError, setApiError] = useState('');

  const validateEmail = (email) => {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
  };

  const validateForm = () => {
    const newErrors = {};

    if (!formData.email.trim()) {
      newErrors.email = 'Email is required';
    } else if (!validateEmail(formData.email)) {
      newErrors.email = 'Please enter a valid email address';
    }

    if (!formData.password) {
      newErrors.password = 'Password is required';
    } else if (formData.password.length < 8) { // Changed to 8 to match backend policy
      newErrors.password = 'Password must be at least 8 characters';
    }

    if (!isLogin && !formData.full_name?.trim()) {
      newErrors.full_name = 'Full name is required';
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleChange = (e) => {
    const { name, value } = e.target;
    setFormData(prev => ({
      ...prev,
      [name]: value
    }));
    if (errors[name]) {
      setErrors(prev => ({ ...prev, [name]: '' }));
    }
    if (apiError) setApiError('');
  };

  const handleSubmit = async (e) => {
    e.preventDefault();

    if (!validateForm()) {
      return;
    }

    setIsLoading(true);
    setApiError('');

    try {
      if (isLogin) {
        await authAPI.login(formData.email, formData.password);
        navigate('/connect');
      } else {
        // Register (Bootstrap)
        await authAPI.register({
          email: formData.email,
          password: formData.password,
          full_name: formData.full_name
        });

        // Auto-login after successful registration
        await authAPI.login(formData.email, formData.password);
        navigate('/connect');
      }
    } catch (error) {
      console.error('Auth error:', error);
      if (error.response?.status === 401 && isLogin) {
        setApiError('Invalid email or password');
      } else if (error.response?.status === 403 && !isLogin) {
        setApiError('Public registration is disabled. Only the system administrator can create new accounts.');
      } else if (error.response?.data?.detail) {
        setApiError(error.response.data.detail);
      } else {
        setApiError('An error occurred. Please try again.');
      }
    } finally {
      setIsLoading(false);
    }
  };

  const toggleMode = () => {
    setIsLogin(!isLogin);
    setApiError('');
    setErrors({});
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-transparent px-4 sm:px-6 lg:px-8">
      <div className="max-w-md w-full space-y-8">
        <div>
          <h2 className="mt-6 text-center text-4xl font-serif font-bold text-brand-teal">
            The Aiviary
          </h2>
          <p className="mt-2 text-center text-sm text-neutral-slate">
            {isLogin ? 'Sign in to your account' : 'Set up your admin account'}
          </p>
        </div>

        <div className="glass-panel py-8 px-6 rounded-lg sm:px-10">
          <form className="space-y-6" onSubmit={handleSubmit} noValidate>
            {apiError && (
              <div
                className="bg-red-50/80 border border-red-200 text-red-700 px-4 py-3 rounded relative"
                role="alert"
                aria-live="polite"
              >
                <span className="block sm:inline">{apiError}</span>
              </div>
            )}

            {!isLogin && (
              <div>
                <label htmlFor="full_name" className="block text-sm font-medium text-neutral-charcoal">
                  Full Name
                </label>
                <div className="mt-1">
                  <input
                    id="full_name"
                    name="full_name"
                    type="text"
                    required
                    value={formData.full_name}
                    onChange={handleChange}
                    className={`input-field ${errors.full_name ? 'input-error' : ''}`}
                    placeholder="John Doe"
                  />
                  {errors.full_name && (
                    <p className="mt-2 text-sm text-red-600">{errors.full_name}</p>
                  )}
                </div>
              </div>
            )}

            <div>
              <label htmlFor="email" className="block text-sm font-medium text-neutral-charcoal">
                Email address
              </label>
              <div className="mt-1">
                <input
                  id="email"
                  name="email"
                  type="email"
                  autoComplete="email"
                  required
                  value={formData.email}
                  onChange={handleChange}
                  className={`input-field ${errors.email ? 'input-error' : ''}`}
                  placeholder="you@example.com"
                  aria-invalid={errors.email ? 'true' : 'false'}
                />
                {errors.email && (
                  <p className="mt-2 text-sm text-red-600" role="alert">
                    {errors.email}
                  </p>
                )}
              </div>
            </div>

            <div>
              <label htmlFor="password" className="block text-sm font-medium text-neutral-charcoal">
                Password
              </label>
              <div className="mt-1">
                <input
                  id="password"
                  name="password"
                  type="password"
                  autoComplete="current-password"
                  required
                  value={formData.password}
                  onChange={handleChange}
                  className={`input-field ${errors.password ? 'input-error' : ''}`}
                  placeholder={isLogin ? "Enter your password" : "Min 8 chars, 1 upper, 1 lower, 1 number"}
                  aria-invalid={errors.password ? 'true' : 'false'}
                />
                {errors.password && (
                  <p className="mt-2 text-sm text-red-600" role="alert">
                    {errors.password}
                  </p>
                )}
              </div>
            </div>

            <div>
              <button
                type="submit"
                disabled={isLoading}
                className="w-full btn-primary flex justify-center items-center"
                aria-busy={isLoading}
              >
                {isLoading ? (
                  <>
                    <svg className="animate-spin -ml-1 mr-3 h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                    </svg>
                    {isLogin ? 'Signing in...' : 'Creating Account...'}
                  </>
                ) : (
                  isLogin ? 'Sign in' : 'Create Admin Account'
                )}
              </button>
            </div>

            <div className="text-center mt-4">
              <button
                type="button"
                onClick={toggleMode}
                className="text-brand-teal hover:text-brand-clay text-sm font-medium focus:outline-none"
              >
                {isLogin ? "First time here? Set up the system" : "Already have an account? Sign in"}
              </button>
            </div>

          </form>
        </div>

        <p className="text-center text-sm text-neutral-slate/70">
          Secure login with httpOnly cookies
        </p>
      </div>
    </div>
  );
};

export default LoginPage;
