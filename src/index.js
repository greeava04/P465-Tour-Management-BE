const express = require('express');
const cors = require('cors');
const mongoose = require('mongoose');
const jwt = require("jsonwebtoken");
const fs = require('fs');
const User = require("../models/userModel");
const Itinerary = require("../models/itineraryModel")
const Booking = require("../models/bookingModel")
const bcrypt = require("bcryptjs");
const handlebars = require('handlebars');
const path = require('path');
// const config = require('./config');
const { google } = require('googleapis');
const crypto = require('crypto');
require('dotenv').config();

const bodyParser = require('body-parser');
const nodemailer = require('nodemailer');

const user = process.env.DBUSER;
const password = process.env.DBPASS;

const privateKey = fs.readFileSync('.private-key')

const dbUrl = process.env.DB || "mongodb://localhost/"

if (user && password) mongoose.connect(dbUrl, {"auth": {"authSource": "admin"}, "user": user, "pass": password, "dbName": "admin"}).then(() => console.log("MongoDB connected!"));
else mongoose.connect(dbUrl).then(() => console.log("MongoDB connected!"));

const app = express();
app.use(cors())
app.use(express.json())
app.use(bodyParser.json());

//storing temporary otp data in memory
const users = {};

app.get('/', (req, res) => {
    res.send("Hello world -- Owen Harris");
})

app.post('/register', async (req, res) => {
    try {
        const { email, password, username, firstName, lastName, phoneNum } = req.body;
        if (!(email && password && username && firstName && lastName && phoneNum)) {
            res.json({
                "error": "Required field not found:"
            })
            return;
        }
        const possibleUser = await User.findOne({ email }) || await User.findOne({ username });
        if (possibleUser) {
            res.json({ "error": "Email/Username already used" })
            return;
        }
        console.log("creating user")
        let newUser = await User.create({
            email,
            "passwordHash": await bcrypt.hash(password, 12),
            username,
            firstName,
            lastName,
            phoneNum
        })
        console.log(newUser);
        const transporter = nodemailer.createTransport({
            service: 'gmail',
            auth: {
                user: gmailId,
                pass: gmailPassword
            }
        });
        const data = {
            firstName: firstName,
            content: `
            We are thrilled to welcome you to the vibrant community of adventurers here at EzTravel!
            <br/>
            <br/>
            Get ready to embark on a journey filled with unforgettable experiences, breathtaking destinations, and lifelong memories waiting to be created.
            <br/>
            <br/>
            Together, let's explore the world, one destination at a time, and make every moment count!
            <br/>
            <br/>`
        }
        const templateStr = fs.readFileSync(path.join(__dirname, '..', 'templates', 'email.hbs')).toString()
        const template = handlebars.compile(templateStr, { noEscape: true });
        const html = template(data);
        const mailOptions = {
            from: gmailId,
            to: email,
            subject: `Welcome Aboard! Let's Craft Memories Together!`,
            html: html
        };
        await transporter.sendMail(mailOptions);
        let id = newUser._id;
        let token = jwt.sign({ id }, privateKey, { expiresIn: "1 day" })
        res.json({ "message": "User created succesfully", token })
    } catch (error) {
        console.error(error);
        res.json({ "error": "Server error" })
    }

})

app.post('/login', async (req, res) => {
    const { email, password } = req.body;
    const possibleUser = await User.findOne({ email });

    if (!possibleUser) {
        res.json({ "error": "UserName/Email not found" })
        return;
    }
    const authed = await bcrypt.compare(password, possibleUser.passwordHash)
    if (!authed) {
        res.json({ "error": "Password incorrect" })
        return;
    }
    let id = possibleUser._id
    let firstName = possibleUser.firstName
    const token = jwt.sign({ id, firstName, email }, privateKey, { expiresIn: "1 day" })
    res.json({ "message": "User authenticated", token })
})

app.post('/verify', async (req, res) => {
    const { token } = req.body;
    jwt.verify(token, privateKey, async (err, data) => {
        if (err) {
            return res.json({ "status": "error", "error": "error"});
        } else {
            const loggedInUser = await User.findById(data.id);
            if (loggedInUser) return res.json({
                email: loggedInUser.email,
                username: loggedInUser.username,
                "_id": loggedInUser._id
            });
            else return res.json({ "status": "error", "error": "error"});
        }
    })
})

//load gmail credentials
const gmailId = process.env.GMAILID
const gmailPassword = process.env.GMAILPASSWORD;

console.log(gmailId, gmailPassword)

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
        if (!possibleUser) {
            res.json({ "error": "UserName/Email not found" })
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
        const user = await User.findOne({ email });

        //return error if user not found
        if (!user) {
            throw new Error('User not found');
        }
        // Check if the new password is the same as the old password
        const isSamePassword = await bcrypt.compare(newPassword, user.passwordHash);
        if (isSamePassword) {
            return res.json({ error: 'New password cannot be the same as the old password' });
        }
        // Update the password
        user.passwordHash = await bcrypt.hash(newPassword, 12);

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

/**
 * @author - adpadgal
 */
const CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const REDIRECT_URI = 'https://auth.harrisowe.me/auth/google/callback';
const session = []

const oauth2Client = new google.auth.OAuth2(
    CLIENT_ID,
    CLIENT_SECRET,
    REDIRECT_URI
);

// Redirect user to Google's OAuth 2.0 server
app.get('/auth/google', (req, res) => {
    const url = oauth2Client.generateAuthUrl({
        access_type: 'offline',
        scope: ['https://www.googleapis.com/auth/userinfo.profile', 'https://www.googleapis.com/auth/userinfo.email'],
        prompt: 'select_account',
    });
    res.redirect(url);
});

// Handle OAuth 2.0 server response
app.get('/auth/google/callback', async (req, res) => {
    const { code } = req.query;
    try {
        const { tokens } = await oauth2Client.getToken(code);
        oauth2Client.setCredentials(tokens);

        // Fetch user details from Google
        const oauth2 = google.oauth2({
            auth: oauth2Client,
            version: 'v2'
        });

        const userinfoResponse = await oauth2.userinfo.get();
        const googleUser = userinfoResponse.data;


        let user = await User.findOne({ googleId: googleUser.id });
        if (!user) {
            // User doesn't exist, so create a new user record
            user = new User({
                googleId: googleUser.id,
                email: googleUser.email,
                firstName: googleUser.given_name,
                lastName: googleUser.family_name,
            });
            await user.save();
            const transporter = nodemailer.createTransport({
                service: 'gmail',
                auth: {
                    user: gmailId,
                    pass: gmailPassword
                }
            });
            const data = {
                firstName: googleUser.given_name,
                content: `
                We are thrilled to welcome you to the vibrant community of adventurers here at EzTravel!
                <br/>
                <br/>
                Get ready to embark on a journey filled with unforgettable experiences, breathtaking destinations, and lifelong memories waiting to be created.
                <br/>
                <br/>
                Together, let's explore the world, one destination at a time, and make every moment count!
                <br/>
                <br/>`
            }
            const templateStr = fs.readFileSync(path.join(__dirname, '..', 'templates', 'email.hbs')).toString()
            const template = handlebars.compile(templateStr, { noEscape: true });
            const html = template(data);
            const mailOptions = {
                from: gmailId,
                to: googleUser.email,
                subject: `Welcome Aboard! Let's Craft Memories Together!`,
                html: html
            };
            await transporter.sendMail(mailOptions);
        }

        const jwtToken = jwt.sign({
            id: user.id,
        }, privateKey, { expiresIn: '1d' });

        console.log(jwtToken);
        const sessionIdentifier = crypto.randomBytes(32).toString('hex');
        session[sessionIdentifier] = { jwt: jwtToken };
        res.redirect(`https://eztravels.me/signin?session_id=${sessionIdentifier}`); // Redirect to the frontend
    } catch (error) {
        console.error('Error during authentication', error);
        res.status(500).send('Authentication error');
    }
});

app.post('/gettoken', async (req, res) => {
    const { sessionId } = req.body;
    console.log(sessionId)
    const tokenInfo = session[sessionId];

    if (tokenInfo && tokenInfo.jwt) {
        res.json({ token: tokenInfo.jwt });
    } else {
        res.status(404).json({ error: 'Invalid session or token not found' });
    }
});


/**
 * @author - adpadgal
 */
app.post("/sendotp", async (req, res) => {
    try {
        const { token } = req.body;
        jwt.verify(token, privateKey, async (err, decoded) => {
            console.log(decoded.id)
            if (err) {
                return res.status(401).json({ error: "Unauthorized" });
            } else {
                const otp = Math.floor(100000 + Math.random() * 900000);
                const transporter = nodemailer.createTransport({
                    service: 'gmail',
                    auth: {
                        user: gmailId,
                        pass: gmailPassword
                    }
                });
                const data = {
                    firstName: decoded.firstName,
                    content: `
                    Greetings from EzTravel, your gateway to extraordinary journeys and unforgettable experiences!
                    <br/>
                    <br/>
                    To ensure the utmost security of your account and safeguard your travel plans, we require a quick verification step.
                    <br/>
                    Please find your one-time password (OTP) below:
                    <br/>
                    <br/>
                    OTP: ${otp}
                    <br/>
                    <br/>
                    Should you have any questions or concerns, our dedicated support team is here to assist you every step of the way.
                    <br/>
                    <br/>
                    Get ready to embark on your next adventure with EzTravel!
                    <br/>
                    <br/>
                    <br/>`
                }
                const templateStr = fs.readFileSync(path.join(__dirname, '..', 'templates', 'email.hbs')).toString()
                const template = handlebars.compile(templateStr, { noEscape: true });
                const html = template(data);
                const mailOptions = {
                    from: gmailId,
                    to: decoded.email,
                    subject: 'Your OTP for Login into EzTravel Account',
                    html: html
                };
                await transporter.sendMail(mailOptions);
                users[decoded.email] = { otp };
                res.status(200).json({ status: "Verification initiated" });
            }
        });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: "Internal Server Error" });
    }
});

/**
 * @author - adpadgal
 */
app.post("/verifyotp", async (req, res) => {
    try {
        const { otpCode, token } = req.body;
        jwt.verify(token, privateKey, async (err, decoded) => {
            if (err) {
                return res.status(401).json({ error: "Unauthorized" });
            } else {
                const json = users[decoded.email]
                if (json.otp == otpCode) {
                    delete users[decoded.email];
                    let id = decoded.id;
                    let token = jwt.sign({ id }, privateKey, { expiresIn: "1 day" })
                    res.status(200).json({ message: "OTP verified", token });
                }
                else {
                    return res.status(401).json({ error: "Invalid OTP entered" });
                }
            }
        });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: "Internal Server Error" });
    }
});


app.post('/api/makeItinerary', async (req, res) => {
    const { title, description, startDate, endDate, token } = req.body; // Get information from request body

    //verify user login

    try {
        let loggedInUser;
        let user = await verifyUserLogIn(token);
        console.log(user);
        if (user.error) {
            return res.status(403).json(user)
        }
        id = user._id;


        console.log("Attempting to create new itinerary for, ", id);

        const itinerary = await Itinerary.create({ title, description, startDate, endDate, "createdBy": id });
        console.log(itinerary)
        return res.json(itinerary)

    } catch (error) {
        console.error(error);
        return res.status(500).json({ "error": "Internal Server Error" });
    }

});

app.post('/api/getItineraryList', async (req, res) => {
    const { token } = req.body;
    try {
        let user = await verifyUserLogIn(token);
        if (user.error) {
            return res.status(403).json(user)
        }

        const Itinerarys = await Itinerary.find({ "createdBy": user._id })
        return res.json(Itinerarys)
    } catch (error) {
        console.error(error);
        return res.status(500).json({ "error": "Internal Server Error" });
    }
})

app.post('/api/getItinerary', async (req, res) => {
    const { token, id } = req.body;
    try {
        let user = await verifyUserLogIn(token);
        if (user.error) {
            return res.status(403).json(user)
        }

        const objID = new mongoose.mongo.ObjectId(id);
        console.log(objID);

        const it = await Itinerary.findOne({ "createdBy": user._id, "_id": objID })
        console.log(it)
        if (it) {
            return res.json(it);
        } else {
            return res.status(404).json({ "error": "Itinerary not found" })
        }
    } catch (error) {
        console.error(error);
        return res.status(500).json({ "error": "Internal Server Error" });
    }
});

app.post('/api/deleteItinerary', async (req, res) => {
    const { token, id } = req.body;
    try {
        let user = await verifyUserLogIn(token);
        if (user.error) {
            return res.status(403).json(user)
        }

        const objID = new mongoose.mongo.ObjectId(id);
        console.log(objID);

        const it = await Itinerary.findOneAndDelete({ "createdBy": user._id, "_id": objID })

        if (it) {
            it.deleted = true;
            return res.json(it);
        } else {
            return res.status(404).json({ "error": "Itinerary not found" })
        }

    } catch (error) {
        console.error(error);
        return res.status(500).json({ "error": "Internal Server Error" });
    }
})

app.post('/api/addActivity', async (req, res) => {
    const { token, id, activity, time_start, time_end } = req.body
    try {
        let user = await verifyUserLogIn(token);
        if (user.error) {
            return res.status(403).json(user)
        }

        const objID = new mongoose.mongo.ObjectId(id);

        const it = await Itinerary.findById(objID);

        if (it) {
            const newActivity = {
                activity: activity,
                time_start: time_start,
                time_end: time_end
            }
            it.activities.push(newActivity);
            await it.save()
            return res.json(it);
        } else {
            return res.status(404).json({ "error": "Itinerary not found" })
        }

    } catch (error) {
        console.error(error);
        return res.status(500).json({ "error": "Internal Server Error" });
    }

})

app.post('/api/addPlace', async (req, res) => {
    const { token, id, place, time_start, time_end } = req.body
    try {
        let user = await verifyUserLogIn(token);
        if (user.error) {
            return res.status(403).json(user)
        }

        const objID = new mongoose.mongo.ObjectId(id);
        const placeID = new mongoose.mongo.ObjectId(place);
        console.log(objID);

        const it = await Itinerary.findById(objID);
        console.log(it)

        if (it) {
            const newDestination = {
                place: placeID,
                time_start: time_start,
                time_end: time_end
            }
            it.destinations.push(newDestination)
            await it.save()
            return res.json(it)
        } else {
            return res.status(404).json({ "error": "Itinerary not found" })
        }

    } catch (error) {
        console.error(error);
        return res.status(500).json({ "error": "Internal Server Error" });
    }
})

app.post('/api/addThing', async (req, res) => {
    const { token, id, type, thing_id, time_start, time_end } = req.body;
    try {
        let user = await verifyUserLogIn(token);
        if (user.error) {
            return res.status(403).json(user)
        }

        const it = await Itinerary.findById(id);

        if (!it) {
            return res.status(404).json({ "error": "Itinerary not found" });
        }

        switch (type) {
            case 'hotel':
                const { days } = req.body;
                const newHotel = {
                    place: thing_id,
                    time_start: time_start,
                    days: days,
                    time_end: time_end,
                }

                it.hotels.push(newHotel);

                await it.save();
                return res.json(it);
            case 'flight':
                const { round_trip } = req.body;
                const newFlight = {
                    place: thing_id,
                    time_start: time_start,
                    time_end: time_end,
                    round_trip: round_trip,
                }
                it.flights.push(newFlight);

                await it.save();
                return res.json(it);
            case 'thing':
                const newThing = {
                    place: thing_id,
                    time_start: time_start,
                    time_end: time_end,
                }
                it.things.push(newThing);
                await it.save();
                return res.json(it);
        }
    } catch (error) {
        console.error(error);
        return res.status(500).json({ "error": "Internal Server Error" });
    }
})

app.post('/api/updateThingTiming', async (req, res) => {
    const { token, id, type, thing_id, time_start, time_end } = req.body;
    try {
        let user = await verifyUserLogIn(token);
        if (user.error) {
            return res.status(403).json(user);
        }
        const objID = new mongoose.Types.ObjectId(id);

        const it = await Itinerary.findById(objID);
        if (!it) {
            return res.status(404).json({ "error": "Itinerary not found" });
        }

        let destination = null;

        switch (type) {
            case 'hotel':
                const { days } = req.body;
                destination = it.hotels.find((thing) => thing.place.equals(thing_id));
                if (!destination) {
                    return res.status(404).json({ "error": "Destination not found in itinerary" });
                }
                destination.time_end = time_end;
                destination.time_start = time_start;
                destination.days = days;
                break;
            case 'flight':
                const { round_trip } = req.body;
                destination = it.flights.find((thing) => thing.place.equals(thing_id));
                if (!destination) {
                    return res.status(404).json({ "error": "Destination not found in itinerary" });
                }
                destination.time_end = time_end;
                destination.time_start = time_start;
                destination.round_trip = round_trip;
                break;
            case 'thing':
                destination = it.things.find((thing) => thing.place.equals(thing_id));
                if (!destination) {
                    return res.status(404).json({ "error": "Destination not found in itinerary" });
                }
                destination.time_end = time_end;
                destination.time_start = time_start;
                break;
        }
        await it.save();

        return res.json(it);
    } catch (error) {
        console.error(error);
        return res.status(500).json({ "error": "Internal Server Error" });
    }
});

app.delete('/api/deleteThing', async (req, res) => {
    const { token, id, type, thing_id } = req.body;
    try {
        let user = await verifyUserLogIn(token);
        if (user.error) {
            return res.status(403).json(user);
        }
        const objID = new mongoose.Types.ObjectId(id);

        const it = await Itinerary.findById(objID);
        if (!it) {
            return res.status(404).json({ "error": "Itinerary not found" });
        }

        let result = null;

        switch (type) {
            case 'hotel':
                result = deleteThing(it.hotels, thing_id);
                break;
            case 'flight':
                result = deleteThing(it.flights, thing_id);
                break;
            case 'thing':
                result = deleteThing(it.things, thing_id);
                break;
        }
        
        if (!result) {
            return res.status(404).json({ "error": "Item not found in the itinerary" });
        }

        await it.save();

        return res.json(it);
    } catch (error) {
        console.error(error);
        return res.status(500).json({ "error": "Internal Server Error" });
    }
});

/**
 * 
 * @param {[]} array Array of desintaions (places, hotels, flights, things)
 * @param {String} thing objID 
 * @returns {Boolean} true if deleted, false if not found
 * @author Owen Harris
 */
function deleteThing(array, thing) {
    const index = array.findIndex(dest => dest.place == thing);
    console.log(index)
    if (index !== -1) {
        array.splice(index, 1);
        return true;
    } else {
        return false;
    }
}



/**
 * Deletes an activity from an itinerary.
 * 
 * @param {object} req - The request object.
 * @param {object} res - The response object.
 * @returns {object} The updated itinerary or an error response.
 * @author avmandal
 */
app.delete('/api/deleteActivity', async (req, res) => {
    const { token, id, activity } = req.body
    try {
        let user = await verifyUserLogIn(token);
        if (user.error) {
            return res.status(403).json(user)
        }

        const objID = new mongoose.mongo.ObjectId(id);

        const it = await Itinerary.findById(objID)

        if (it) {
            const index = it.activities.findIndex(act => act.activity === activity);
            console.log(index)
            if (index !== -1) {
                it.activities.splice(index, 1);
                await it.save();
                return res.json(it);
            } else {
                return res.status(404).json({ "error": "Item not found in the itinerary" });
            }
        } else {
            return res.status(404).json({ "error": "Itinerary not found" });
        }
    } catch (error) {
        console.error(error);
        return res.status(500).json({ "error": "Internal Server Error" });
    }

})

/**
 * Deletes a place from an itinerary.
 * 
 * @param {object} req - The request object.
 * @param {object} res - The response object.
 * @returns {object} The updated itinerary or an error response.
 * @author avmandal
 */
app.delete('/api/deletePlace', async (req, res) => {
    const { token, id, place } = req.body
    try {
        let user = await verifyUserLogIn(token);
        if (user.error) {
            return res.status(403).json(user)
        }
        console.log(place)

        const objID = new mongoose.mongo.ObjectId(id);

        const it = await Itinerary.findById(objID);

        if (it) {
            const index = it.destinations.findIndex(dest => dest.place.equals(place));
            console.log(index)
            if (index !== -1) {
                it.destinations.splice(index, 1)
                await it.save()
                return res.json(it)
            } else {
                return res.status(404).json({ "error": "Item not found in the itinerary" });
            }

        } else {
            return res.status(404).json({ "error": "Itinerary not found" })
        }

    } catch (error) {
        console.error(error);
        return res.status(500).json({ "error": "Internal Server Error" });
    }
})

/**
 * Updates the timing of a place in an itinerary.
 * 
 * @param {object} req - The request object.
 * @param {object} res - The response object.
 * @returns {object} The updated itinerary or an error response.
 * @author avmandal
 */
app.post('/api/updatePlaceTiming', async (req, res) => {
    const { token, id, place, time_start, time_end } = req.body;
    try {
        let user = await verifyUserLogIn(token);
        if (user.error) {
            return res.status(403).json(user);
        }
        const objID = new mongoose.Types.ObjectId(id);

        const it = await Itinerary.findById(objID);
        if (!it) {
            return res.status(404).json({ "error": "Itinerary not found" });
        }

        const destination = it.destinations.find(dest => dest.place.equals(place));
        if (!destination) {
            return res.status(404).json({ "error": "Destination not found in itinerary" });
        }

        if (time_start !== undefined) {
            destination.time_start = time_start;
        }
        if (time_end !== undefined) {
            destination.time_end = time_end;
        }
        await it.save();

        return res.json(it);
    } catch (error) {
        console.error(error);
        return res.status(500).json({ "error": "Internal Server Error" });
    }
});

/**
 * Updates the timing of an activity in an itinerary.
 * 
 * @param {object} req - The request object.
 * @param {object} res - The response object.
 * @returns {object} The updated itinerary or an error response.
 * @author avmandal
 */
app.post('/api/updateActivityTiming', async (req, res) => {
    const { token, id, activity, time_start, time_end } = req.body;
    try {
        let user = await verifyUserLogIn(token);
        if (user.error) {
            return res.status(403).json(user);
        }
        const objID = new mongoose.Types.ObjectId(id);

        const it = await Itinerary.findById(objID);
        if (!it) {
            return res.status(404).json({ "error": "Itinerary not found" });
        }

        const act = it.activities.find(act => act.activity === activity);
        if (!act) {
            return res.status(404).json({ "error": "Activity not found in itinerary" });
        }

        if (time_start !== undefined) {
            act.time_start = time_start;
        }
        if (time_end !== undefined) {
            act.time_end = time_end;
        }
        await it.save();

        return res.json(it);
    } catch (error) {
        console.error(error);
        return res.status(500).json({ "error": "Internal Server Error" });
    }
});

/**
 * Shares the itinerary.
 * 
 * @param {object} req - The request object.
 * @param {object} res - The response object.
 * @returns {object} The itinerary ID or an error response.
 * @author avmandal
 */
app.post('/api/shareItinerary', async (req, res) => {
    const { token, id } = req.body;
    try {
        let user = await verifyUserLogIn(token);
        if (user.error) {
            return res.status(403).json(user);
        }
        const objID = new mongoose.Types.ObjectId(id);

        const it = await Itinerary.findById(objID);
        if (!it) {
            return res.status(404).json({ "error": "Itinerary not found" });
        }
        return res.status(200).json({ status: "shared", id: it._id })
    } catch (error) {
        console.error(error);
        return res.status(500).json({ "error": "Internal Server Error" });
    }
});

/**
 * Gets an itinerary with the help of ID.
 * 
 * @param {object} req - The request object.
 * @param {object} res - The response object.
 * @returns {object} The itinerary or an error response.
 * @author avmandal
 */
app.get('/api/getSharedItinerary/:id', async (req, res) => {
    const { id } = req.params;

    try {
        const objID = new mongoose.Types.ObjectId(id);

        const it = await Itinerary.findById(objID);
        if (!it) {
            return res.status(404).json({ "error": "Itinerary not found" });
        }

        await it.save();
        return res.json(it)

    } catch (error) {
        console.error(error);
        return res.status(500).json({ "error": "Internal Server Error" });
    }
});

/**
 * Adds comment to the itinerary
 * 
 * @param {object} req - The request object.
 * @param {object} res - The response object.
 * @returns {object} The updated itinerary or an error response.
 * @author avmandal
 */
app.post('/api/addComment', async (req, res) => {
    const { itineraryId, token, comment } = req.body;

    try {
        let user = await verifyUserLogIn(token);
        console.log(user)
        if (user.error) {
            return res.status(403).json(user);
        }
        const objID = new mongoose.Types.ObjectId(itineraryId);

        const it = await Itinerary.findById(objID);
        if (!it) {
            return res.status(404).json({ "error": "Itinerary not found" });
        }

        const newComment = {
            body: comment,
            itineraryId: itineraryId,
            username: user.username
        };

        it.comments.push(newComment);
        await it.save();

        return res.json(it);


    } catch (error) {
        console.error(error);
        return res.status(500).json({ "error": "Internal Server Error" });
    }
});

app.get('/api/convertCurrency', async (req, res) => {
    const base = req.query.base_currency
    const currencies = req.query.currencies;

    console.log("Running convert currency")

    const response = await fetch(`https://api.currencyapi.com/v3/latest?base_currency=${base}&currencies=${currencies}`, {
        method: "GET",
        headers: {
            "Content-Type": "application/json",
            "apikey": process.env.API_KEY
        }
    });

    const json = await response.json();
    return res.json(json);
});

app.post('/api/makeBooking', async (req, res) => {
    const { itineraryID, token } = req.body;
    try {
        let user = await verifyUserLogIn(token);

        if (user.error) {
            return res.status(403).json({ user })
        }

        let it = await Itinerary.findById(itineraryID);

        if (!it) {
            return res.status(404).json({ "error": "Itinerary not found" })
        }

        if (await Booking.findOne({ fromItinerary: itineraryID })) {
            return res.status(500).json({ "error": "Booking already made for itinerary" })
        }

        let price = 0;

        let hotelPrice = await computePrice(it.hotels, "hotels/", "hotel")
        let flightPrice = await computePrice(it.flights, "flights/", "flight")
        let thingsToDo = await computePrice(it.things, "things-to-do/", "thingToDo")
        let placePrice = await computePrice(it.destinations, "places/", "place")

        price = hotelPrice + flightPrice + thingsToDo + placePrice; // Might need to specially compute hotel price


        let booking = await Booking.create({
            title: it.title,
            hotels: it.hotels,
            flights: it.flights,
            things: it.things,
            totalPrice: price,
            createdBy: it.createdBy,
            fromItinerary: itineraryID,
            destinations: it.destinations,
        })

        const transporter = nodemailer.createTransport({
            service: 'gmail',
            auth: {
                user: gmailId,
                pass: gmailPassword
            }
        });

        const mailOptions = {
            from: gmailId,
            to: user.email,
            subject: 'New Booking!',
            text: `Thank you for booking with EZTrip! Please use this link to view your booking: https://owenhar1.asuscomm.com/booking?id=${booking._id}`
        };

        await transporter.sendMail(mailOptions);


        return res.json(booking);
    } catch (error) {
        console.error(error);
        return res.status(500).json({ "error": "internal server error" })
    }

})

app.post('/api/getBookingPrice', async (req, res) => {
    const { itineraryID, token } = req.body;
    let user = await verifyUserLogIn(token);

    if (user.error) {
        return res.status(403).json({ user })
    }

    let it = await Itinerary.findById(itineraryID);

    if (!it) {
        return res.status(404).json({ "error": "Itinerary not found" })
    }

    if (await Booking.findOne({ fromItinerary: itineraryID })) {
        return res.status(500).json({ "error": "Booking already made for itinerary" })
    }

    let price = 0;



    let hotelPrice = await computePrice(it.hotels, "hotels/", "hotel")
    let flightPrice = await computePrice(it.flights, "flights/", "flight")
    let thingsToDo = await computePrice(it.things, "things-to-do/", "thingToDo")
    let placePrice = await computePrice(it.destinations, "places/", "place")

    price = placePrice + hotelPrice + flightPrice + thingsToDo;

    return res.json(price);
})

app.post('/api/getBooking', async (req, res) => {
    const { token, bookingID } = req.body;

    let user = await verifyUserLogIn(token);

    if (user.error) {
        return res.status(403).json({ user })
    }
    let booking;
    if (bookingID) {
        booking = await Booking.findById(bookingID);
    } else {
        booking = await Booking.findOne({ "createdBy": user._id });
    }

    if (booking) {
        return res.json(booking);
    } else {
        return res.status(404).json({ "error": "Booking not found" });
    }

});

async function verifyUserLogIn(token) {
    return jwt.verify(token, privateKey, async (err, data) => {
        if (err) {
            return { "error": "Unable to verify login" }
        } else {
            const loggedInUser = await User.findById(data.id);
            if (!loggedInUser) {
                return { "error": "Unable to verify login" }
            } else {
                return loggedInUser;
            }
        }
    })
}


async function computePrice(array, endPoint, type) {
    const placeLink = process.env.PLACE_LINK;
    try {
        let price = 0.0;
        // console.log(array)
        if (!array) {
            return 0;
        }
        for (let objID of [...array]) {
            console.log(placeLink + endPoint + objID.place);
            let response = await fetch(placeLink + endPoint + objID.place);
            let json = await response.json();
            if (json[type].price) {
                price += Number(json[type].price);
            } else {
                console.log(endPoint, "didn't have price for", objID);
            }
        }
        return price;
    } catch (error) {
        console.error(error, endPoint, type)
        return 0;
    }
}





app.listen(process.argv[2] || 3000);
