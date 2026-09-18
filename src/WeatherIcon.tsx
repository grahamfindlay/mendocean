import {
  Sun,
  CloudSun,
  Cloud,
  CloudFog,
  CloudDrizzle,
  CloudRain,
  CloudSnow,
  CloudLightning,
  CircleHelp,
} from "lucide-react";
import { weatherDescription } from "../shared/presentation";

export default function WeatherIcon({ code }: { code: number | null }) {
  const Icon =
    code === 0 || code === 1
      ? Sun
      : code === 2
        ? CloudSun
        : code === 3
          ? Cloud
          : code === 45 || code === 48
            ? CloudFog
            : code !== null && [51, 53, 55, 56, 57].includes(code)
              ? CloudDrizzle
              : code !== null && [61, 63, 65, 66, 67, 80, 81, 82].includes(code)
                ? CloudRain
                : code !== null && [71, 73, 75, 77, 85, 86].includes(code)
                  ? CloudSnow
                  : code !== null && [95, 96, 99].includes(code)
                    ? CloudLightning
                    : CircleHelp;
  return (
    <Icon
      className="weather-icon"
      size={20}
      role="img"
      aria-label={weatherDescription(code)}
    />
  );
}
