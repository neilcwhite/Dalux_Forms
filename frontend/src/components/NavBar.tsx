import { NavLink } from "react-router-dom";

export default function NavBar() {
  const linkClass = ({ isActive }: { isActive: boolean }) =>
    `px-3 py-1.5 rounded text-sm font-medium transition-colors ${
      isActive
        ? "bg-[#233E99] text-white"
        : "text-gray-700 hover:bg-gray-100"
    }`;

  return (
    <nav className="flex gap-1 mb-4">
      <NavLink to="/" end className={linkClass}>Forms</NavLink>
      <NavLink to="/sites" className={linkClass}>Sites</NavLink>
    </nav>
  );
}