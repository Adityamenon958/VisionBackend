const { createClient } = require('@supabase/supabase-js');

/**
 * Supabase Service
 * 
 * Provides Supabase client instance and helper functions for authentication
 * and user management. This service handles all interactions with Supabase.
 */

let supabaseClient = null;

/**
 * Get or create Supabase client instance
 * Uses service role key for admin operations
 */
function getSupabaseClient() {
  if (!supabaseClient) {
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !supabaseServiceKey) {
      throw new Error('Supabase configuration missing. Please set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env');
    }

    supabaseClient = createClient(supabaseUrl, supabaseServiceKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false
      }
    });
  }

  return supabaseClient;
}

/**
 * Get user profile from Supabase JWT token
 * 
 * @param {string} token - JWT token from Authorization header
 * @returns {Promise<Object|null>} User profile object or null if invalid
 */
async function getUserFromToken(token) {
  try {
    if (!token) {
      return null;
    }

    const supabase = getSupabaseClient();
    
    // Verify token and get user
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    
    if (authError || !user) {
      return null;
    }

    // Get user profile with role and company_id
    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('id, email, role, company_id')
      .eq('id', user.id)
      .single();

    if (profileError || !profile) {
      return null;
    }

    return {
      id: profile.id,
      email: profile.email || user.email,
      role: profile.role,
      company_id: profile.company_id
    };
  } catch (error) {
    console.error('Error getting user from token:', error.message);
    return null;
  }
}

/**
 * Get user role from Supabase
 * 
 * @param {string} userId - User ID (UUID)
 * @returns {Promise<string|null>} User role or null if not found
 */
async function getUserRole(userId) {
  try {
    const supabase = getSupabaseClient();
    
    const { data, error } = await supabase
      .from('profiles')
      .select('role')
      .eq('id', userId)
      .single();

    if (error || !data) {
      return null;
    }

    return data.role;
  } catch (error) {
    console.error('Error getting user role:', error.message);
    return null;
  }
}

/**
 * Update user role in Supabase
 * 
 * @param {string} userId - User ID (UUID)
 * @param {string} newRole - New role to assign
 * @returns {Promise<{success: boolean, error?: string}>}
 */
async function updateUserRole(userId, newRole) {
  try {
    const supabase = getSupabaseClient();
    
    const { error } = await supabase
      .from('profiles')
      .update({ role: newRole })
      .eq('id', userId);

    if (error) {
      return {
        success: false,
        error: error.message
      };
    }

    return {
      success: true
    };
  } catch (error) {
    console.error('Error updating user role:', error.message);
    return {
      success: false,
      error: error.message
    };
  }
}

/**
 * Get user profile by ID
 * 
 * @param {string} userId - User ID (UUID)
 * @returns {Promise<Object|null>} User profile or null if not found
 */
async function getUserProfile(userId) {
  try {
    const supabase = getSupabaseClient();
    
    const { data, error } = await supabase
      .from('profiles')
      .select('id, email, role, company_id')
      .eq('id', userId)
      .single();

    if (error || !data) {
      return null;
    }

    return {
      id: data.id,
      email: data.email,
      role: data.role,
      company_id: data.company_id
    };
  } catch (error) {
    console.error('Error getting user profile:', error.message);
    return null;
  }
}

module.exports = {
  getSupabaseClient,
  getUserFromToken,
  getUserRole,
  updateUserRole,
  getUserProfile
};
