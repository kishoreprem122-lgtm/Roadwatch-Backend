
const mongoose = require("mongoose");

const reportSchema = new mongoose.Schema(
  {
    damageType: {
      type: String,
      required: [true, "Please select a road damage type"],
      trim: true,
    },
    latitude: {
      type: Number,
      required: [true, "GPS latitude is required"],
    },
    longitude: {
      type: Number,
      required: [true, "GPS longitude is required"],
    },
    imagePath: {
      type: String,
      default: "",
    },
    status: {
      type: String,
      enum: ["Reported", "Under Review", "In Progress", "Resolved", "Rejected"],
      default: "Reported",
    },
  },
  { timestamps: true }
);

module.exports =
  mongoose.models.Report || mongoose.model("Report", reportSchema);
