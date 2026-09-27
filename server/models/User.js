import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';

const userSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, 'Name is required'],
      trim: true,
    },
    email: {
      type: String,
      required: [true, 'Email is required'],
      unique: true,
      lowercase: true,
      trim: true,
    },
    password: {
      type: String,
      required: [true, 'Password is required'],
      minlength: [6, 'Password must be at least 6 characters'],
    },
    /* OpenID Connect identity (present only for SSO accounts). `provider`
       is the OIDC issuer, `providerId` the provider's immutable `sub`.
       An SSO-only account has a random unusable password hash. */
    oidc: {
      issuer: { type: String, default: '' },
      providerId: { type: String, default: '' },
      picture: { type: String, default: '' },
    },
    branch: {
      type: String,
      default: 'Computer Science & Engineering',
      trim: true,
    },
    semester: {
      type: Number,
      default: 6,
      min: 1,
      max: 8,
    },
    targetAttendance: {
      type: Number,
      default: 75,
      min: 50,
      max: 100,
    },
    college: {
      type: String,
      default: 'Engineering Institute of Technology',
      trim: true,
    },
  },
  {
    timestamps: true,
  }
);

userSchema.pre('save', async function (next) {
  if (!this.isModified('password')) {
    return next();
  }
  const salt = await bcrypt.genSalt(10);
  this.password = await bcrypt.hash(this.password, salt);
  next();
});

userSchema.methods.matchPassword = async function (enteredPassword) {
  if (!this.password) return false; // SSO-only account has no usable password
  return await bcrypt.compare(enteredPassword, this.password);
};

export const User = mongoose.model('User', userSchema);
export default User;
