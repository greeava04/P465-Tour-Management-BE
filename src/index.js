const express = require('express');
const cors = require('cors');
const mongoose = require('mongoose');
const jwt = require("jsonwebtoken");
const fs = require('fs');
const User = require("../models/userModel");
const bcrypt = require("bcryptjs");

const bodyParser = require('body-parser');
const nodemailer = require('nodemailer');

const privateKey = fs.readFileSync('.private-key')

mongoose.connect("mongodb://10.1.1.109/admin").then(() => console.log("MongoDB connected!"))

const app = express();
app.use(cors())
app.use(express.json())
app.use(bodyParser.json());

//storing temporary data in memory
const users = {};

app.get('/', (req,res) => {
    res.send("Hello world -- Owen Harris");
})

app.post('/register', async (req, res) => {
    try {
        const {email, password, username, firstName, lastName, phoneNum} = req.body;
        if (!(email && password && username && firstName && lastName && phoneNum )) {
            res.json({
                "error": "Required field not found:"
            })
            return;
        }
        const possibleUser = await User.findOne( { email } ) || await User.findOne({ username });
        if (possibleUser) {
            res.json({"error" : "Email/Username already used"})
            return;
        }
        console.log("creating user")
        let newUser = await User.create({
            email, 
            "passwordHash" : await bcrypt.hash(password, 12),
            username,
            firstName,
            lastName,
            phoneNum
        })
        console.log(newUser);
        let id = newUser._id;
        let token = jwt.sign({ id }, privateKey, {expiresIn: "1 day"})
        res.json({ "message": "User created succesfully", token })
    } catch (error) {
        console.error(error);
        res.json({ "error" : "Server error"})
    }

})

app.post('/login', async (req, res) => {
    const {email, password} = req.body;
    const possibleUser = await User.findOne({ email });

    if(!possibleUser) {
        res.json({ "error": "UserName/Email not found"})
        return;
    }
    const authed = await bcrypt.compare(password, possibleUser.passwordHash)
    if (!authed) {
        res.json({ "error": "Password incorrect" })
        return;
    }
    let id = possibleUser._id
    const token = jwt.sign({ id }, privateKey, {expiresIn: "1 day"})
    res.json({ "message": "User authenticated", token })
})

app.post('/verify', async (req, res) => {
    const { token } = req.body;
    jwt.verify(token, privateKey, async (err, data) => {
        if (err) {
            return res.json({ "status": "error"});
        } else {
            const loggedInUser = await User.findById(data.id);
            if (loggedInUser) return res.json({
                email: loggedInUser.email,
                username: loggedInUser.username
            });
            else return res.json({ "status": "error"});
        }
    })
})

//load gmail cred
const gmailId = process.env.GMAIL_ID;
const gmailPassword = process.env.GMAIL_PASSWORD; 

/**
 * Request OTP for Forgot and reset password: Sends out an otp to registered email id upon validation
 * @param {string} email - Users email ID.
 * @returns {forgotpassword<void>} - Resolves if opt sent successfully, rejects with error otherwise.
 * @author - ysampath
 */
app.post('/api/forgotpassword', async (req, res) => {
    const { email } = req.body;
        try {
            // validate user
            const possibleUser = await User.findOne({ email });
            //if not user,return
            if(!possibleUser) {
                res.json({ "error": "UserName/Email not found"})
                return;
            }
            // Generate OTP 
            const otp = Math.floor(100000 + Math.random() * 900000); // 6-digit OTP

            // Send OTP to email
            const transporter = nodemailer.createTransport({
                service: 'gmail',
                auth: {
                  user: gmailId,
                  pass: gmailPassword
             }
           });

          const mailOptions = {
                from: gmailId,
                to: email,
                subject: 'Forgot Password OTP',
                text: `Your OTP for password reset is ${otp}`
            };

            await transporter.sendMail(mailOptions);

            // Save OTP to user object in memory
            users[email] = { otp };

            return res.json({ success: true, message: 'OTP sent to your email' });
        } catch (error) {
            console.error(error);
            return res.status(500).json({ error: 'Server error' });
        }

    });

/**
 * Set Forgot and reset password: validate otp and update password on validation.
 * @param {string} email - Users email ID.
 * @param {int} otp - generated otp.
 * @param {string} newPassword - new user password.
 * @returns {resetpassword<void>} - Resolves if password is updated successfully, rejects with error otherwise.
 * @author - ysampath
 */
app.post('/api/resetpassword', async (req, res) => {
    const { email, otp, newPassword } = req.body;
    try {
        // Check if OTP matches
        if (!users[email] || users[email].otp !== otp) {
            return res.json({ error: 'Invalid OTP' });
        }
        // Reset Password
        // hashing password
        // const hashedPassword = await bcrypt.hash(newPassword, 12);
        const user = await User.findById(email);
        
        //return error if user not found
        if (!user) {
            throw new Error('User not found');
        }
        // Update the password
        user.passwordHash = newPassword;
        
        // Save the updated user object
        await user.save()

        console.log(`Password for ${email} reset successfully to: ${newPassword}`);

        // Remove OTP from memory
        delete users[email];

        return res.json({ success: true, message: 'Password reset successful' });
    } catch (error) {
        console.error(error);
        return res.status(500).json({ error: 'Password reset failed' });
    }
});

app.listen(3000);
