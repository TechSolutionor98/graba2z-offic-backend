/**
 * Create Super Admin Script
 * 
 * This script creates a super admin user or upgrades an existing admin to super admin.
 * 
 * Usage:
 *   node scripts/createSuperAdmin.js <email> [password]
 * 
 * If the user exists, they will be upgraded to super admin.
 * If they don't exist, a new super admin account will be created.
 */

import mongoose from "mongoose"
import dotenv from "dotenv"
import User from "../models/userModel.js"
import connectDB from "../config/db.js"

dotenv.config()

const createSuperAdmin = async () => {
  try {
    await connectDB()
    
    const email = process.argv[2]
    const password = process.argv[3] || "SuperAdmin@123"
    
    if (!email) {
      console.error("❌ Please provide an email address")
      console.log("Usage: node scripts/createSuperAdmin.js <email> [password]")
      process.exit(1)
    }
    
    // Check if user exists
    let user = await User.findOne({ email })
    
    if (user) {
      // Upgrade to super admin
      console.log(`📝 User ${email} found. Upgrading to Super Admin...`)
      
      user.isAdmin = true
      user.isSuperAdmin = true
      user.adminPermissions = { fullAccess: true }
      
      await user.save()
      
      console.log(`✅ Successfully upgraded ${email} to Super Admin!`)
    } else {
      // Create new super admin
      console.log(`📝 Creating new Super Admin: ${email}`)
      
      user = await User.create({
        name: "Super Admin",
        email,
        password,
        isAdmin: true,
        isSuperAdmin: true,
        isEmailVerified: true,
        adminPermissions: { fullAccess: true },
      })
      
      console.log(`✅ Successfully created Super Admin: ${email}`)
      console.log(`   Password: ${password}`)
    }
    
    console.log("\n📋 Super Admin Details:")
    console.log(`   ID: ${user._id}`)
    console.log(`   Email: ${user.email}`)
    console.log(`   Name: ${user.name}`)
    console.log(`   Is Admin: ${user.isAdmin}`)
    console.log(`   Is Super Admin: ${user.isSuperAdmin}`)
    
    process.exit(0)
  } catch (error) {
    console.error("❌ Error:", error.message)
    process.exit(1)
  }
}

createSuperAdmin()
